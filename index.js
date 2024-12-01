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
const USAGE_LOG_FILE = "usage_log.json";
const MONTHLY_TOKEN_QUOTA = 10_000_000; // Free tier: 10M tokens
const TOKEN_OVERAGE_RATE = 0.0001; // $0.0001 per token over quota

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

// Modify the usage tracking object
let usageStats = {
  totalBatches: 0,
  totalTexts: 0,
  totalTokens: 0,
  estimatedCost: 0,
  quotaUsagePercent: 0,
  errors: 0,
  startTime: null,
  endTime: null,
  duration: null,
};

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

// Update the saveUsageStats function
const saveUsageStats = () => {
  usageStats.endTime = new Date().toISOString();

  // Calculate duration
  const start = new Date(usageStats.startTime);
  const end = new Date(usageStats.endTime);
  usageStats.duration = ((end - start) / 1000 / 60).toFixed(2) + " minutes";

  // Calculate quota usage and costs
  usageStats.quotaUsagePercent = (
    (usageStats.totalTokens / MONTHLY_TOKEN_QUOTA) *
    100
  ).toFixed(2);

  // Calculate potential overage costs
  const overageTokens = Math.max(
    0,
    usageStats.totalTokens - MONTHLY_TOKEN_QUOTA
  );
  usageStats.estimatedCost = (overageTokens * TOKEN_OVERAGE_RATE).toFixed(2);

  fs.writeFileSync(
    USAGE_LOG_FILE,
    JSON.stringify(usageStats, null, 2),
    "utf-8"
  );

  // Log a usage summary
  console.log(`
📊 Usage Summary:
   • Processed ${usageStats.totalTexts} texts in ${
    usageStats.totalBatches
  } batches
   • Total tokens: ${usageStats.totalTokens.toLocaleString()}
   • Monthly quota usage: ${usageStats.quotaUsagePercent}%
   • Estimated overage cost: $${usageStats.estimatedCost}
   • Duration: ${usageStats.duration}
   • Errors: ${usageStats.errors}
  `);
};

// Main function
const generateEmbeddings = async () => {
  usageStats.startTime = new Date().toISOString();
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

    // Update usage stats
    usageStats.totalBatches++;
    usageStats.totalTexts += texts.length;
    // Rough token estimation (assuming ~4 chars per token)
    usageStats.totalTokens += texts.reduce(
      (sum, text) => sum + Math.ceil(text.length / 4),
      0
    );

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
      usageStats.errors++;
      console.error(
        `❌ Error processing batch starting at ${i}: ${error.message}`
      );
      // Save progress even on error so we can resume from this point
      saveProgress();
      saveUsageStats(); // Save usage stats on error
      throw error; // Re-throw to stop processing
    }

    // Save progress after each batch
    saveProgress();
  }

  // Save final usage stats
  saveUsageStats();
  console.log("🎉 All embeddings generated successfully!");
};

// Load CSV, process, and generate embeddings
const processMovies = () => {
  fs.createReadStream("criterion_movies.csv")
    .pipe(csv())
    .on("data", (row) => movies.push(row))
    .on("end", async () => {
      try {
        await generateEmbeddings();
      } catch (error) {
        console.error("❌ Fatal error:", error.message);
        saveUsageStats(); // Save usage stats on fatal error
      }
    })
    .on("error", (err) => {
      console.error("❌ Error reading CSV file:", err.message);
      saveUsageStats(); // Save usage stats on CSV error
    });
};

// Load existing embeddings and start processing
loadExistingEmbeddings();
processMovies();

// Handle interruption gracefully
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Gracefully shutting down...");
  saveProgress();
  saveUsageStats();
  process.exit(0);
});

// Also add SIGTERM handling for other types of termination
process.on("SIGTERM", async () => {
  console.log("\n\n🛑 Received termination signal...");
  saveProgress();
  saveUsageStats();
  process.exit(0);
});
