const fs = require("fs");
const csv = require("csv-parser");
const axios = require("axios");
const Bottleneck = require("bottleneck");
require("dotenv").config(); // Load environment variables

// Configuration
const API_KEY = process.env.NOMIC_API_KEY; // Load API key from .env
const API_URL = "https://api-atlas.nomic.ai/v1/embedding/text";
const EMBEDDINGS_FILE = "criterion_embeddings.json";
const R2_EMBEDDINGS_URL = "https://r2.ejfox.com/criterion_embeddings.json";
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

// Helper function: Load existing embeddings
const loadExistingEmbeddings = async () => {
  // Check if embeddings file exists locally
  if (!fs.existsSync(EMBEDDINGS_FILE)) {
    console.log(`📥 Embeddings file not found locally. Downloading from R2...`);
    try {
      await downloadEmbeddingsFromR2();
    } catch (error) {
      console.error(`❌ Failed to download embeddings: ${error.message}`);
      // Initialize empty embeddings if download fails
      embeddings = [];
      lastProcessedIndex = 0;
      return;
    }
  }

  try {
    const savedData = JSON.parse(fs.readFileSync(EMBEDDINGS_FILE, "utf-8"));
    embeddings = savedData.embeddings || [];
    lastProcessedIndex = savedData.lastProcessedIndex || 0;
    console.log(
      `🔄 Loaded ${embeddings.length} embeddings. Starting from index ${lastProcessedIndex}`
    );
  } catch (error) {
    console.error(`❌ Error loading embeddings: ${error.message}`);
    // Initialize empty embeddings if parsing fails
    embeddings = [];
    lastProcessedIndex = 0;
  }
};

// Helper function: Download embeddings from R2
const downloadEmbeddingsFromR2 = async () => {
  console.log(`🚀 Downloading embeddings from R2...`);

  try {
    const response = await axios({
      method: "get",
      url: R2_EMBEDDINGS_URL,
      responseType: "stream",
    });

    const writer = fs.createWriteStream(EMBEDDINGS_FILE);

    return new Promise((resolve, reject) => {
      response.data.pipe(writer);

      let error = null;
      writer.on("error", (err) => {
        error = err;
        writer.close();
        reject(err);
      });

      writer.on("close", () => {
        if (!error) {
          console.log(`✅ Successfully downloaded embeddings file.`);
          resolve();
        }
        // No need to reject here as it would have been called in the 'error' event
      });
    });
  } catch (error) {
    console.error(`❌ Error downloading embeddings: ${error.message}`);
    throw error;
  }
};

// Helper function: Save progress
const saveProgress = () => {
  // Support NDJSON format
  const outputFormat = process.env.OUTPUT_FORMAT || "json";
  const outputFile = process.env.OUTPUT_FILE || EMBEDDINGS_FILE;
  
  if (outputFormat === "ndjson") {
    // For NDJSON, write each embedding on its own line
    const ndjsonData = embeddings.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.writeFileSync(outputFile, ndjsonData, "utf-8");
  } else {
    // Original JSON format
    const saveData = {
      embeddings,
      lastProcessedIndex,
    };
    fs.writeFileSync(outputFile, JSON.stringify(saveData, null, 2), "utf-8");
  }
  console.log(`✅ Progress saved to ${outputFile} (format: ${outputFormat})`);
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
      // API request for the batch (with configurable parameters)
      const taskType = process.env.TASK_TYPE || "search_document";
      const dimensionality = parseInt(process.env.DIMENSIONALITY) || 768;
      
      const response = await limiter.schedule(() =>
        axios.post(
          API_URL,
          {
            texts,
            task_type: taskType,
            max_tokens_per_text: 8192,
            dimensionality: dimensionality,
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
(async () => {
  await loadExistingEmbeddings();
  processMovies();
})();

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
