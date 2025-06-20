# Embedding Providers Guide

## 🚀 Multi-Provider Support

This project supports multiple embedding providers through a unified interface. Switch between providers using environment variables!

## 🔧 Supported Providers

### 1. **Nomic** (Default)
```bash
EMBEDDING_PROVIDER=nomic
NOMIC_API_KEY=your_nomic_key
NOMIC_DIMENSIONALITY=768  # or 256
TASK_TYPE=search_document # search_document, clustering, classification
```
- **Dimensions**: 768 or 256
- **Cost**: Free tier (10M tokens/month)
- **Best for**: General purpose, document search

### 2. **OpenAI**
```bash
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_openai_key
OPENAI_EMBEDDING_MODEL=text-embedding-3-small  # or text-embedding-3-large
OPENAI_DIMENSIONS=1536  # Optional dimension reduction for v3 models
```
- **Models**: text-embedding-3-small (1536d), text-embedding-3-large (3072d), text-embedding-ada-002 (1536d)
- **Cost**: $0.02-$0.13 per 1M tokens
- **Best for**: High quality, latest SOTA performance

### 3. **LM Studio** (Local) 🔥
```bash
EMBEDDING_PROVIDER=lmstudio
LMSTUDIO_BASE_URL=http://localhost:1234/v1/embeddings
LMSTUDIO_MODEL=model-identifier
LMSTUDIO_DIMENSIONS=384  # Depends on your model
LMSTUDIO_MAX_TOKENS=512
```
- **Cost**: FREE! (runs locally)
- **Privacy**: Data never leaves your machine
- **Models**: Any GGUF embedding model (e.g., Qwen3-Embedding-0.6B-GGUF)
- **Best for**: Privacy, experimentation, cost control

### 4. **Cohere**
```bash
EMBEDDING_PROVIDER=cohere
COHERE_API_KEY=your_cohere_key
COHERE_MODEL=embed-english-v3.0
```
- **Dimensions**: 1024 (embed-english-v3.0)
- **Cost**: $0.10 per 1M tokens
- **Best for**: Multilingual support, search applications

## 🧪 Testing Providers

Test individual providers:
```bash
# Test specific provider
node test-providers.js nomic
node test-providers.js openai
node test-providers.js lmstudio
node test-providers.js cohere

# Test all available providers
node test-providers.js
```

## 🔬 Provider Comparison

Run side-by-side comparisons:
```bash
# This will test all providers with API keys set
node test-providers.js
```

Example output:
```
🔬 Running comparison test with 3 working providers...
⚡ PERFORMANCE COMPARISON:
   nomic: 768d, 1200ms, $0.000000
   openai: 1536d, 800ms, $0.000020
   lmstudio: 384d, 2000ms, $0.000000
```

## 🎯 Choosing the Right Provider

### For Production
- **High Quality**: OpenAI text-embedding-3-large (3072d, $0.13/1M tokens)
- **Balanced**: OpenAI text-embedding-3-small (1536d, $0.02/1M tokens)  
- **Free Tier**: Nomic (768d, free up to 10M tokens)

### For Development/Experimentation
- **Privacy**: LM Studio with local models (free, private)
- **Speed**: Nomic (good performance, reliable)

### For Specific Use Cases
- **Multilingual**: Cohere embed-english-v3.0
- **Large Scale**: LM Studio (no API costs)
- **Research**: Any provider for A/B testing

## 🚀 Usage Examples

### Basic Usage
```bash
# Use default provider (Nomic)
npm start

# Switch to OpenAI
EMBEDDING_PROVIDER=openai npm start

# Use local LM Studio
EMBEDDING_PROVIDER=lmstudio npm start
```

### Combined with Wikipedia
```bash
# OpenAI embeddings + Wikipedia enrichment + NDJSON output
EMBEDDING_PROVIDER=openai \
ENABLE_WIKIPEDIA=true \
OUTPUT_FORMAT=ndjson \
npm start
```

### Provider-Specific Configuration
```bash
# High-dimension OpenAI embeddings
EMBEDDING_PROVIDER=openai \
OPENAI_EMBEDDING_MODEL=text-embedding-3-large \
OUTPUT_FORMAT=ndjson \
npm start

# Local embedding with custom model
EMBEDDING_PROVIDER=lmstudio \
LMSTUDIO_MODEL=qwen3-embedding \
LMSTUDIO_DIMENSIONS=512 \
npm start
```

## 📊 Output Enhancement

All embeddings now include provider metadata:
```json
{
  "title": "Mulholland Dr.",
  "_embedding_metadata": {
    "provider": "openai",
    "model": "text-embedding-3-small", 
    "dimensions": 1536,
    "generated_at": "2025-06-20T20:00:00.000Z"
  },
  "title_embedding": [...],
  "description_embedding": [...]
}
```

## 🛠️ Local Model Setup (LM Studio)

1. Download LM Studio: https://lmstudio.ai/
2. Download an embedding model (e.g., Qwen3-Embedding-0.6B-GGUF)
3. Start the local server in LM Studio
4. Set environment variables:
   ```bash
   EMBEDDING_PROVIDER=lmstudio
   LMSTUDIO_MODEL=your_model_name
   ```

Perfect for privacy-focused or cost-sensitive applications!

## 🔥 Pro Tips

- **A/B Testing**: Run the same movies through different providers to compare semantic understanding
- **Cost Optimization**: Use LM Studio for bulk processing, OpenAI for critical applications
- **Hybrid Approach**: Different providers for different content types (titles vs descriptions vs Wikipedia)
- **Fallback Strategy**: Primary provider + backup provider for reliability

The multi-provider system makes experimentation and optimization effortless! 🚀