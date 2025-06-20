const axios = require('axios');

/**
 * Multi-Provider Embedding Interface
 * 
 * Supports:
 * - Nomic (current)
 * - OpenAI (text-embedding-3-small/large)
 * - LM Studio (local models)
 * - Cohere
 * - Sentence Transformers (future)
 */

class EmbeddingProvider {
  constructor(config) {
    this.config = config;
    this.name = config.name;
    this.rateLimiter = config.rateLimiter;
  }

  async embed(texts) {
    throw new Error('embed() must be implemented by provider');
  }

  getDimensions() {
    throw new Error('getDimensions() must be implemented by provider');
  }

  getMaxTokens() {
    return this.config.maxTokens || 8192;
  }

  getCost() {
    return this.config.costPer1MTokens || 0;
  }
}

class NomicProvider extends EmbeddingProvider {
  constructor(config) {
    super({
      name: 'nomic',
      apiUrl: 'https://api-atlas.nomic.ai/v1/embedding/text',
      dimensions: parseInt(process.env.NOMIC_DIMENSIONALITY) || 768,
      maxTokens: 8192,
      costPer1MTokens: 0, // Free tier
      ...config
    });
    
    if (!process.env.NOMIC_API_KEY) {
      throw new Error('NOMIC_API_KEY is required');
    }
  }

  async embed(texts) {
    const taskType = process.env.TASK_TYPE || 'search_document';
    
    const response = await this.rateLimiter.schedule(() =>
      axios.post(
        this.config.apiUrl,
        {
          texts,
          task_type: taskType,
          max_tokens_per_text: this.config.maxTokens,
          dimensionality: this.config.dimensions,
        },
        { 
          headers: { Authorization: `Bearer ${process.env.NOMIC_API_KEY}` },
          timeout: 30000
        }
      )
    );

    return {
      embeddings: response.data.embeddings,
      model: `nomic-embed-text-v1.5-${this.config.dimensions}d`,
      dimensions: this.config.dimensions,
      usage: {
        prompt_tokens: texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
        total_tokens: texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0)
      }
    };
  }

  getDimensions() {
    return this.config.dimensions;
  }
}

class OpenAIProvider extends EmbeddingProvider {
  constructor(config) {
    super({
      name: 'openai',
      apiUrl: 'https://api.openai.com/v1/embeddings',
      model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      dimensions: parseInt(process.env.OPENAI_DIMENSIONS) || null, // Auto-detect
      maxTokens: 8191,
      costPer1MTokens: 0.02, // text-embedding-3-small
      ...config
    });

    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required');
    }

    // Set dimensions based on model
    if (!this.config.dimensions) {
      const modelDimensions = {
        'text-embedding-3-small': 1536,
        'text-embedding-3-large': 3072,
        'text-embedding-ada-002': 1536
      };
      this.config.dimensions = modelDimensions[this.config.model] || 1536;
    }

    // Set cost based on model  
    const modelCosts = {
      'text-embedding-3-small': 0.02,
      'text-embedding-3-large': 0.13,
      'text-embedding-ada-002': 0.10
    };
    this.config.costPer1MTokens = modelCosts[this.config.model] || 0.02;
  }

  async embed(texts) {
    const requestBody = {
      input: texts,
      model: this.config.model
    };

    // Optional dimension reduction for text-embedding-3 models
    if (this.config.model.includes('text-embedding-3') && process.env.OPENAI_DIMENSIONS) {
      requestBody.dimensions = parseInt(process.env.OPENAI_DIMENSIONS);
    }

    const response = await this.rateLimiter.schedule(() =>
      axios.post(
        this.config.apiUrl,
        requestBody,
        { 
          headers: { 
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      )
    );

    return {
      embeddings: response.data.data.map(item => item.embedding),
      model: this.config.model,
      dimensions: this.config.dimensions,
      usage: response.data.usage
    };
  }

  getDimensions() {
    return this.config.dimensions;
  }
}

class LMStudioProvider extends EmbeddingProvider {
  constructor(config) {
    super({
      name: 'lmstudio',
      apiUrl: process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1/embeddings',
      model: process.env.LMSTUDIO_MODEL || 'model-identifier',
      dimensions: parseInt(process.env.LMSTUDIO_DIMENSIONS) || 384, // Common for local models
      maxTokens: parseInt(process.env.LMSTUDIO_MAX_TOKENS) || 512,
      costPer1MTokens: 0, // Local = free!
      ...config
    });
  }

  async embed(texts) {
    try {
      // Test connection first
      await this.testConnection();

      const embeddings = [];
      
      // Process texts one by one (some local models prefer this)
      for (const text of texts) {
        const cleanText = text.replace(/\n/g, ' ');
        
        const response = await axios.post(
          this.config.apiUrl,
          {
            input: [cleanText],
            model: this.config.model
          },
          {
            headers: {
              'Authorization': 'Bearer lm-studio', // LM Studio expects this
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );

        if (response.data.data && response.data.data[0]) {
          embeddings.push(response.data.data[0].embedding);
        } else {
          throw new Error('Invalid response format from LM Studio');
        }
      }

      return {
        embeddings,
        model: this.config.model,
        dimensions: this.config.dimensions,
        usage: {
          prompt_tokens: texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
          total_tokens: texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0)
        }
      };

    } catch (error) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('LM Studio is not running or not accessible at ' + this.config.apiUrl);
      }
      throw error;
    }
  }

  async testConnection() {
    try {
      // Try to get models list to test connection
      const modelsUrl = this.config.apiUrl.replace('/embeddings', '/models');
      await axios.get(modelsUrl, {
        headers: { 'Authorization': 'Bearer lm-studio' },
        timeout: 5000
      });
    } catch (error) {
      throw new Error('Cannot connect to LM Studio. Make sure it\'s running and serving embeddings.');
    }
  }

  getDimensions() {
    return this.config.dimensions;
  }
}

class CohereProvider extends EmbeddingProvider {
  constructor(config) {
    super({
      name: 'cohere',
      apiUrl: 'https://api.cohere.ai/v1/embed',
      model: process.env.COHERE_MODEL || 'embed-english-v3.0',
      dimensions: 1024, // embed-english-v3.0 default
      maxTokens: 512,
      costPer1MTokens: 0.10,
      ...config
    });

    if (!process.env.COHERE_API_KEY) {
      throw new Error('COHERE_API_KEY is required');
    }
  }

  async embed(texts) {
    const response = await this.rateLimiter.schedule(() =>
      axios.post(
        this.config.apiUrl,
        {
          texts,
          model: this.config.model,
          input_type: 'search_document' // or 'search_query', 'classification', 'clustering'
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.COHERE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      )
    );

    return {
      embeddings: response.data.embeddings,
      model: this.config.model,
      dimensions: this.config.dimensions,
      usage: {
        prompt_tokens: texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
        total_tokens: texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0)
      }
    };
  }

  getDimensions() {
    return this.config.dimensions;
  }
}

// Factory function to create provider instances
const createEmbeddingProvider = (providerName, rateLimiter) => {
  const providers = {
    'nomic': NomicProvider,
    'openai': OpenAIProvider,
    'lmstudio': LMStudioProvider,
    'cohere': CohereProvider
  };

  const ProviderClass = providers[providerName.toLowerCase()];
  if (!ProviderClass) {
    throw new Error(`Unknown embedding provider: ${providerName}. Available: ${Object.keys(providers).join(', ')}`);
  }

  return new ProviderClass({ rateLimiter });
};

// Helper function to get provider from environment
const getDefaultProvider = (rateLimiter) => {
  const provider = process.env.EMBEDDING_PROVIDER || 'nomic';
  return createEmbeddingProvider(provider, rateLimiter);
};

// Provider comparison utilities
const compareProviders = async (texts, providers) => {
  console.log(`🔬 Comparing ${providers.length} embedding providers...`);
  
  const results = {};
  
  for (const provider of providers) {
    console.log(`   Testing ${provider.name}...`);
    const startTime = Date.now();
    
    try {
      const result = await provider.embed(texts);
      const duration = Date.now() - startTime;
      
      results[provider.name] = {
        success: true,
        dimensions: result.dimensions,
        model: result.model,
        duration: duration,
        usage: result.usage,
        cost: (result.usage.total_tokens / 1000000) * provider.getCost(),
        embeddings: result.embeddings
      };
      
      console.log(`     ✅ ${result.dimensions}d in ${duration}ms (${result.model})`);
      
    } catch (error) {
      results[provider.name] = {
        success: false,
        error: error.message,
        duration: Date.now() - startTime
      };
      
      console.log(`     ❌ Failed: ${error.message}`);
    }
  }
  
  return results;
};

module.exports = {
  EmbeddingProvider,
  NomicProvider,
  OpenAIProvider,
  LMStudioProvider,
  CohereProvider,
  createEmbeddingProvider,
  getDefaultProvider,
  compareProviders
};