const fs = require("fs");
const csv = require("csv-parser");
const axios = require("axios");
const Bottleneck = require("bottleneck");
require("dotenv").config(); // Load environment variables

// Configuration
const API_KEY = process.env.NOMIC_API_KEY; // Load API key from .env
const API_URL = "https://api-atlas.nomic.ai/v1/embedding/text";
const OUTPUT_FILE = "embeddings.json";
const BATCH_SIZE = 10; // Number of embeddings to process per batch

// Ensure API key exists
if (!API_KEY) {
  console.error(
    "❌ API key is missing. Please set NOMIC_API_KEY in your .env file."
  );
  process.exit(1);
}

// Initialize variables
const movies = [];
let embeddings = [];
let lastProcessedIndex = 0;

// Bottleneck for rate-limiting
const limiter = new Bottleneck({
  minTime: 200, // Limit to 5 requests per second
});

// Helper function: Save progress
const saveProgress = () => {
  const saveData = {
    embeddings,
    lastProcessedIndex,
  };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(saveData, null, 2), "utf-8");
  console.log(`✅ Progress saved to ${OUTPUT_FILE}`);
};

// Helper function: Load existing embeddings
const loadExistingEmbeddings = () => {
  if (fs.existsSync(OUTPUT_FILE)) {
    const savedData = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf-8"));
    embeddings = savedData.embeddings || [];
    lastProcessedIndex = savedData.lastProcessedIndex || 0;
    console.log(
      `🔄 Resuming from existing progress. Loaded ${embeddings.length} embeddings. Starting from index ${lastProcessedIndex}`
    );
  }
};

// Helper function: Filter unprocessed movies
const filterUnprocessedMovies = () => {
  const processedIDs = new Set(embeddings.map((e) => e.ID)); // Use IDs for tracking
  return movies.filter((movie) => !processedIDs.has(movie.ID));
};

// Main function
const generateEmbeddings = async () => {
  console.log(`📄 Parsed ${movies.length} movies from the CSV.`);

  // Filter movies to process
  const moviesToProcess = filterUnprocessedMovies();
  console.log(
    `🚀 Starting embedding generation for ${moviesToProcess.length} unprocessed movies.`
  );

  // Batch processing
  for (
    let i = lastProcessedIndex;
    i < moviesToProcess.length;
    i += BATCH_SIZE
  ) {
    const batch = moviesToProcess.slice(i, i + BATCH_SIZE);
    const texts = batch.flatMap((movie) => [
      movie["Title (Data retrieved 2019-06-21)"], // Title
      movie.Description, // Description
    ]);

    try {
      // API request for the batch
      const response = await limiter.schedule(() =>
        axios.post(
          API_URL,
          {
            texts,
            task_type: "search_document",
            max_tokens_per_text: 8192,
            dimensionality: 768,
          },
          { headers: { Authorization: `Bearer ${API_KEY}` } }
        )
      );

      // Map embeddings back to movies
      batch.forEach((movie, index) => {
        embeddings.push({
          ...movie,
          title_embedding: response.data.embeddings[index * 2], // Title embedding
          description_embedding: response.data.embeddings[index * 2 + 1], // Description embedding
        });
      });

      // Update lastProcessedIndex after successful processing
      lastProcessedIndex = i + BATCH_SIZE;

      console.log(
        `✅ Processed batch ${Math.ceil((i + 1) / BATCH_SIZE)} (${
          i + batch.length
        }/${moviesToProcess.length}).`
      );
    } catch (error) {
      console.error(
        `❌ Error processing batch starting at ${i}: ${error.message}`
      );
      // Save progress even on error so we can resume from this point
      saveProgress();
      throw error; // Re-throw to stop processing
    }

    // Save progress after each batch
    saveProgress();
  }

  console.log("🎉 All embeddings generated successfully!");
};

// Load CSV, process, and generate embeddings
const processMovies = () => {
  fs.createReadStream("criterion_movies.csv")
    .pipe(csv())
    .on("data", (row) => movies.push(row))
    .on("end", async () => {
      await generateEmbeddings();
    })
    .on("error", (err) => {
      console.error("❌ Error reading CSV file:", err.message);
    });
};

// Load existing embeddings and start processing
loadExistingEmbeddings();
processMovies();
