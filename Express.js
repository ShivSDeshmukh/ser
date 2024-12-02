const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const PropertiesReader = require("properties-reader");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");

const app = express(); // Create an Express application

// Configure connection to MongoDB
let propertiesPath = path.resolve(
  __dirname,
  "fetch-server",
  "conf",
  "db.properties"
);
let properties = PropertiesReader(propertiesPath);
let dbPrefix = properties.get("db.prefix");
let dbUser = properties.get("db.user");
let dbPwd = encodeURIComponent(properties.get("db.pwd")); // Encode password
let dbName = properties.get("db.dbName");
let dbUrl = properties.get("db.dbUrl");
let dbParams = properties.get("db.params");

// Construct the MongoDB URI
const uri = `${dbPrefix}${dbUser}:${dbPwd}${dbUrl}${dbParams}`;
let client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });
let db = client.db(dbName);

// Connect to MongoDB and create text index on 'subject' and 'location'
client
  .connect()
  .then(async () => {
    console.log("MongoDB connected successfully");

    try {
      const lessons = db.collection("lessons");
      const indexResult = await lessons.createIndex({
        subject: "text",
        location: "text",
      });
    } catch (indexError) {
      console.error("Error creating index:", indexError);
    }
  })
  .catch((err) => {
    console.error("MongoDB connection failed", err);
    process.exit(1); // Exit process if connection fails
  });

// Set JSON formatting for responses
app.set("json spaces", 3);

// Serve static images with CORS headers
const imagePath = path.resolve(__dirname, "images");
app.use("/images", (req, res, next) => {
  const fileRequested = path.join(imagePath, req.path);
  fs.access(fileRequested, fs.constants.F_OK, (err) => {
    if (err) {
      res.status(404).json({ error: "Image not found" });
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.sendFile(fileRequested);
    }
  });
});

// Middleware
app.use(cors()); // Enable CORS
app.use(morgan("combined")); // Enable logging
app.use(express.json()); // Parse JSON requests
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded requests

// Route: Search lessons with full-text and regex fallback
app.get("/search", async (req, res, next) => {
  const searchQuery = req.query.q;

  if (!searchQuery) {
    return res.status(406).json({ error: "Search query is required." });
  }

  try {
    const lessons = db.collection("lessons");
    const results = await lessons.find({ $text: { $search: searchQuery } }).toArray();

    if (results.length === 0) {
      const regexResults = await lessons
        .find({
          $or: [
            { subject: { $regex: searchQuery, $options: "i" } },
            { location: { $regex: searchQuery, $options: "i" } },
          ],
        })
        .toArray();

      if (regexResults.length === 0) {
        return res.status(404).json({ error: "No lessons found." });
      }
      return res.json(regexResults);
    }

    res.json(results);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "An error occurred during the search." });
  }
});

// Route: Get all lessons
app.get("/lessons", (req, res, next) => {
  db.collection("lessons")
    .find({})
    .toArray()
    .then((classes) => res.json(classes))
    .catch((error) => {
      console.error("Error fetching lessons:", error);
      next(error);
    });
});

// Route: Create an order
app.post("/order", (req, res, next) => {
  const orderData = req.body;
  const { orderInfo, lessonId } = orderData;

  if (!lessonId.every((id) => ObjectId.isValid(id))) {
    return res.status(400).json({ error: "One or more lesson IDs are invalid." });
  }

  console.log("Order received:", orderData);

  db.collection("order")
    .insertOne({ orderInfo, lessonId })
    .then((result) =>
      res.status(201).json({
        message: "Order placed successfully",
        insertedId: result.insertedId,
      })
    )
    .catch((error) => {
      console.error("Error saving order:", error);
      next(error);
    });
});

// Route: Update a lesson by ID
app.put("/updateLesson/:id", (req, res, next) => {
  const lessonId = req.params.id;

  if (!ObjectId.isValid(lessonId)) {
    return res.status(408).json({ error: "Invalid lesson ID." });
  }

  const updatedData = req.body;

  if (!updatedData || Object.keys(updatedData).length === 0) {
    return res.status(408).json({ error: "No data provided for update." });
  }

  db.collection("lessons")
    .updateOne({ _id: new ObjectId(lessonId) }, { $set: updatedData })
    .then((result) => {
      if (result.modifiedCount > 0) {
        res.json({ message: "Lesson updated successfully" });
      } else {
        res.status(408).json({ error: "Lesson not found or no fields changed." });
      }
    })
    .catch((error) => {
      console.error("Error updating lesson:", error);
      next(error);
    });
});

// Route: Delete a lesson by ID
app.delete("/deleteLesson/:id", (req, res, next) => {
  const lessonId = req.params.id;

  if (!ObjectId.isValid(lessonId)) {
    return res.status(408).json({ error: "Invalid lesson ID." });
  }

  db.collection("lessons")
    .deleteOne({ _id: new ObjectId(lessonId) })
    .then((result) => {
      if (result.deletedCount > 0) {
        res.json({ message: "Lesson deleted successfully" });
      } else {
        res.status(408).json({ error: "Lesson not found." });
      }
    })
    .catch((error) => {
      console.error("Error deleting lesson:", error);
      next(error);
    });
});

// Global error-handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: "Something went wrong!",
    error: err.message || "Internal Server Error",
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "success",
    message: "Server is healthy and running!",
    timestamp: new Date(),
  });
});

// Start the server
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(
    `Server is running on https://myapp-env.eba-qzx7ttw3.eu-west-2.elasticbeanstalk.com/${port}`
  );
});
