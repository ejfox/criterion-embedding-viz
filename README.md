# Criterion Embedding Visualization

<img width="1012" alt="Screenshot 2024-12-01 at 4 54 29 PM" src="https://github.com/user-attachments/assets/59b4f762-3dd5-4c46-bd45-98bdff8f0535">

This project is designed to create vector embeddings for Criterion movie titles and descriptions using the Nomic Embedding API. The embeddings can be used for advanced data analysis, clustering, and visualization, enabling deeper exploration of the Criterion Channel's catalog.

## Note About Embeddings File

The `criterion_embeddings.json` file (~156MB) is stored on R2 and not in the Git repository due to its large size. Use the provided download script to fetch it.

## Objectives

The primary objective of this project is to leverage natural language processing (NLP) techniques to generate meaningful embeddings for textual data in the Criterion movie dataset. These embeddings encode semantic relationships between movie titles and descriptions, which can be used in tasks such as similarity analysis, clustering, and visualization.

## Provenance

The dataset utilized in this project originates from a publicly available spreadsheet shared on Reddit by [u/morbusiff](https://www.reddit.com/user/morbusiff). The spreadsheet contains detailed information on movies available on the Criterion Channel as of 2019. 

- **Source Spreadsheet**: [Criterion Channel Videos Spreadsheet](https://docs.google.com/spreadsheets/d/1-ctl5IGVUqfkCH48DFUbLx0iQai9r6BLG9NStMwxPSw/edit?gid=740795620#gid=740795620)
- **Original Reddit Post**: [4,176 Criterion Channel Videos in a Spreadsheet](https://www.reddit.com/r/criterion/comments/bba5go/4176_criterion_channel_videos_in_a_spreadsheet/)

We acknowledge and thank [u/morbusiff](https://www.reddit.com/user/morbusiff) for compiling and sharing this valuable dataset.

## Methodology

1. **Data Input**:
   - The dataset is provided in CSV format (`criterion_movies.csv`) and contains information such as titles, descriptions, directors, years, and links.

2. **Embedding Generation**:
   - The `index.js` script processes the dataset to generate embeddings using the [Nomic Embedding API](https://docs.nomic.ai/).
   - Separate embeddings are created for both the **title** and **description** of each movie to capture different semantic representations.

3. **Batch Processing**:
   - The script processes data in batches to optimize API usage.
   - Rate-limiting is implemented via the `bottleneck` library to respect API constraints.

4. **Output**:
   - Embeddings are saved in JSON format (`criterion_embeddings.json`), maintaining a structured representation of the data alongside the generated embeddings.

## Features

- **Efficient Batch Processing**: Groups multiple embeddings in a single API call to reduce overhead.
- **Title and Description Embeddings**: Provides separate embeddings for both fields to allow fine-grained analysis.
- **Progress Saving and Resumption**: Automatically resumes processing from the last completed batch after interruptions.
- **Rate Limiting**: Ensures compliance with API constraints using `bottleneck`.

## Requirements

- Node.js (v14 or higher)
- A valid Nomic API key

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/ejfox/criterion-embedding-viz.git
   cd criterion-embedding-viz
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables by creating a `.env` file:
   ```bash
   echo "NOMIC_API_KEY=your_nomic_api_key" > .env
   ```
   
   ### Advanced Configuration Options
   ```bash
   # Output format
   OUTPUT_FORMAT=ndjson        # "json" or "ndjson" (newline-delimited JSON)
   OUTPUT_FILE=criterion_embeddings.ndjson
   
   # Embedding configuration
   TASK_TYPE=search_document   # "search_document", "search_query", "clustering", "classification"
   DIMENSIONALITY=768          # 768 or 256 for Nomic
   ```

4. Place your dataset in the root directory as `criterion_movies.csv`.

5. Download the embeddings file:
   ```bash
   ./download-embeddings.sh
   ```
   This downloads the pre-generated embeddings file (~156MB) from Cloudflare R2.

## Execution

Run the script to generate embeddings:
```bash
node index.js
```

## Data Output

The script generates embeddings in `criterion_embeddings.json`. Each entry includes:
- Metadata from the CSV dataset.
- Separate embeddings for the movie title and description.

### Sample JSON Output
```json
[
  {
    "Title (Data retrieved 2019-06-21)": "Mulholland Dr.",
    "Description": "Directed by David Lynch...",
    "title_embedding": [0.0256958, 0.00015819073, ...],
    "description_embedding": [0.03456134, -0.0124586, ...]
  },
  ...
]
```

## Applications

The generated embeddings can be used for:
- Semantic similarity analysis between movies.
- Clustering based on descriptive content.
- Visualization of relationships within the dataset using dimensionality reduction techniques (e.g., PCA, t-SNE, UMAP).

## Limitations

- The embeddings are limited to the semantic information provided in titles and descriptions. Additional metadata (e.g., genre, director) could enhance future analyses.
- Generated embeddings are dependent on the Nomic API's embedding model as of the time of execution.

## Ethical Considerations

- **Data Provenance**: The dataset was shared publicly and is used for analytical purposes. Attribution is provided to the original compiler.
- **Intellectual Property**: Ensure proper use of Criterion Channel data in compliance with its terms of service and copyright regulations.

## Future Enhancements / TODO

### Wikipedia Enrichment
Concept: Automatically find and embed Wikipedia articles for each movie to create richer embeddings:
- Use Wikipedia API to search for each movie title + year + director
- Implement human spot-checking interface to verify correct matches
- Extract and chunk Wikipedia content by logical sections (plot, cast, production, reception, etc.)
- Generate embeddings for each section separately
- Could enable deeper semantic search like "films about existentialism" or "movies with troubled productions"
- Store Wikipedia URLs and section embeddings alongside movie data

### Multi-Provider Embedding Support
Make it easy to swap between different embedding services:
- **OpenRouter** (priority) - Access to multiple models through one API
- OpenAI embeddings (text-embedding-3-small/large)
- Cohere embeddings
- Local embeddings (sentence-transformers)

Challenges to solve:
- Different providers use different dimensions (OpenAI: 1536/3072, Nomic: 768/256, etc.)
- Need abstraction layer to handle different API formats
- Store provider metadata with embeddings for compatibility
- Consider dimension reduction techniques for cross-provider compatibility

## Acknowledgments

Special thanks to [u/morbusiff](https://www.reddit.com/user/morbusiff) for compiling and sharing the original dataset on Reddit.


