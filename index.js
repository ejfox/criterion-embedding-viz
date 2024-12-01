const fs = require("fs");
const csv = require("csv-parser");
const axios = require("axios");
const Bottleneck = require("bottleneck");
require("dotenv").config(); // Load environment variables

const API_KEY = process.env.NOMIC_API_KEY; // Load API key from .env
const API_URL = "https://api-atlas.nomic.ai/v1/embedding/text";
const OUTPUT_FILE = "embeddings.json";
const BATCH_SIZE = 10; // Number of embeddings to process per batch

if (!API_KEY) {
  console.error("❌ API key is missing. Please set NOMIC_API_KEY in your .env file.");
  process.exit(1);
}

// Initialize variables
const movies = [];
let embeddings = [];

// Bottleneck for rate-limiting
const limiter = new Bottleneck({
  minTime: 200, // Limit to 5 requests per second
});

// Helper function to save progress
const saveProgress = () => {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(embeddings, null, 2), "utf-8");
  console.log(`✅ Progress saved to ${OUTPUT_FILE}`);
};

// Load existing embeddings if the script is interrupted
if (fs.existsSync(OUTPUT_FILE)) {
  embeddings = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf-8"));
  console.log(`🔄 Resuming from existing progress. Loaded ${embeddings.length} embeddings.`);
}

// Read CSV and generate embeddings
fs.createReadStream("criterion_movies.csv")
  .pipe(csv())
  .on("data", (row) => movies.push(row))
  .on("end", async () => {
    console.log(`📄 Parsed ${movies.length} movies from the CSV.`);

    // Filter out already processed movies
    const processedTitles = new Set(embeddings.map((e) => e.title));
    const moviesToProcess = movies.filter(
      (movie) => !processedTitles.has(movie["Title (Data retrieved 2019-06-21)"])
    );

    console.log(
      `🚀 Starting embedding generation for ${moviesToProcess.length} unprocessed movies.`
    );

    // Batch processing
    for (let i = 0; i < moviesToProcess.length; i += BATCH_SIZE) {
      const batch = moviesToProcess.slice(i, i + BATCH_SIZE);
      const texts = batch.flatMap((movie) => [
        movie["Title (Data retrieved 2019-06-21)"], // Title
        movie.Description, // Description
      ]);

      try {
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

        console.log(
          `✅ Processed batch ${Math.ceil((i + 1) / BATCH_SIZE)} (${i + batch.length}/${
            moviesToProcess.length
          }).`
        );
      } catch (error) {
        console.error(`❌ Error processing batch starting at ${i}: ${error.message}`);
      }

      // Save progress after each batch
      saveProgress();
    }

    console.log("🎉 All embeddings generated successfully!");
  })
  .on("error", (err) => {
    console.error("❌ Error reading CSV file:", err.message);
  });
