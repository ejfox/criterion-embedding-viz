const fs = require("fs");
const csv = require("csv-parser");
const axios = require("axios");
const Bottleneck = require("bottleneck");
const { processMoviesWithWikipedia, enrichMovieWithWikipedia } = require("./wikipedia-enrichment");
const { getDefaultProvider, createEmbeddingProvider } = require("./embedding-providers");
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

// Wikipedia Integration Settings
const ENABLE_WIKIPEDIA = process.env.ENABLE_WIKIPEDIA === "true";
const WIKIPEDIA_ONLY = process.env.WIKIPEDIA_ONLY === "true"; // Just do Wikipedia, skip embeddings

// API key checking is now handled by individual providers

// Initialize variables
const movies = [];
let embeddings = [];
let lastProcessedIndex = 0;

// Bottleneck for rate-limiting
const limiter = new Bottleneck({
  minTime: 200, // Limit to 5 requests per second
});

// Initialize embedding provider
let embeddingProvider;
try {
  const providerName = process.env.EMBEDDING_PROVIDER || 'nomic';
  embeddingProvider = createEmbeddingProvider(providerName, limiter);
  console.log(`🤖 Using ${embeddingProvider.name} embeddings (${embeddingProvider.getDimensions()}d)`);
} catch (error) {
  console.error('❌ Failed to initialize embedding provider:', error.message);
  process.exit(1);
}

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
    const texts = [];
    const textTypes = []; // Track what type each embedding represents
    
    batch.forEach((movie) => {
      // Original title and description
      texts.push(movie["Title (Data retrieved 2019-06-21)"]);
      textTypes.push('title');
      
      texts.push(movie.Description);
      textTypes.push('description');
      
      // Wikipedia content if available
      if (movie.wikipedia && movie.wikipedia.found && movie.wikipedia.sections) {
        // Add Wikipedia summary
        texts.push("Wikipedia Summary: " + movie.wikipedia.summary);
        textTypes.push('wikipedia_summary');
        
        // Add key Wikipedia sections (limit to avoid token limits)
        const keySection = movie.wikipedia.sections.find(s => 
          s.title.toLowerCase().includes('plot') || 
          s.title.toLowerCase().includes('synopsis')
        ) || movie.wikipedia.sections[0]; // Fallback to first section
        
        if (keySection) {
          texts.push(`Wikipedia ${keySection.title}: ${keySection.content.substring(0, 1000)}`);
          textTypes.push('wikipedia_section');
        }
      }
    });

    // Update usage stats
    usageStats.totalBatches++;
    usageStats.totalTexts += texts.length;
    // Rough token estimation (assuming ~4 chars per token)
    usageStats.totalTokens += texts.reduce(
      (sum, text) => sum + Math.ceil(text.length / 4),
      0
    );

    try {
      // Generate embeddings using the selected provider
      console.log(`   🤖 Generating embeddings with ${embeddingProvider.name} (${texts.length} texts)`);
      const result = await embeddingProvider.embed(texts);
      
      // Update usage stats with actual token usage
      if (result.usage) {
        usageStats.totalTokens += result.usage.total_tokens;
      }

      // Map embeddings back to movies
      let embeddingIndex = 0;
      batch.forEach((movie) => {
        const movieWithEmbeddings = { 
          ...movie,
          _embedding_metadata: {
            provider: embeddingProvider.name,
            model: result.model,
            dimensions: result.dimensions,
            generated_at: new Date().toISOString()
          }
        };
        
        // Always have title and description
        movieWithEmbeddings.title_embedding = result.embeddings[embeddingIndex++];
        movieWithEmbeddings.description_embedding = result.embeddings[embeddingIndex++];
        
        // Add Wikipedia embeddings if available
        if (movie.wikipedia && movie.wikipedia.found && movie.wikipedia.sections) {
          movieWithEmbeddings.wikipedia_summary_embedding = result.embeddings[embeddingIndex++];
          
          // Key section embedding
          const keySection = movie.wikipedia.sections.find(s => 
            s.title.toLowerCase().includes('plot') || 
            s.title.toLowerCase().includes('synopsis')
          ) || movie.wikipedia.sections[0];
          
          if (keySection) {
            movieWithEmbeddings.wikipedia_section_embedding = result.embeddings[embeddingIndex++];
            movieWithEmbeddings.wikipedia_section_title = keySection.title;
          }
        }
        
        embeddings.push(movieWithEmbeddings);
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
        if (WIKIPEDIA_ONLY) {
          // Just do Wikipedia enrichment, no embeddings
          console.log("🔍 Wikipedia-only mode enabled");
          await processMoviesWithWikipedia(movies);
          console.log("🎉 Wikipedia enrichment complete!");
        } else if (ENABLE_WIKIPEDIA) {
          // Do Wikipedia enrichment first, then embeddings
          console.log("🔍 Wikipedia enrichment enabled");
          const enrichedMovies = await processMoviesWithWikipedia(movies);
          
          // Replace movies array with enriched version
          movies.length = 0;
          movies.push(...enrichedMovies);
          
          // Now generate embeddings with Wikipedia content
          await generateEmbeddings();
        } else {
          // Original behavior - just embeddings
          await generateEmbeddings();
        }
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
