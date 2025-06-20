require('dotenv').config(); // Load environment variables
const { createEmbeddingProvider, compareProviders } = require('./embedding-providers');
const Bottleneck = require('bottleneck');

// Rate limiter for testing
const rateLimiter = new Bottleneck({
  minTime: 1000, // 1 second between requests for testing
});

// Test data - famous Criterion films
const testTexts = [
  "Mulholland Dr. - A love story in the city of dreams, directed by David Lynch",
  "Seven Samurai - Akira Kurosawa's epic tale of honor and sacrifice in feudal Japan",
  "8½ - Federico Fellini's surreal meditation on creativity and artistic inspiration"
];

async function testSingleProvider(providerName) {
  console.log(`\n🧪 Testing ${providerName.toUpperCase()} provider...`);
  
  try {
    const provider = createEmbeddingProvider(providerName, rateLimiter);
    console.log(`   Provider: ${provider.name}`);
    console.log(`   Dimensions: ${provider.getDimensions()}`);
    console.log(`   Max tokens: ${provider.getMaxTokens()}`);
    console.log(`   Cost per 1M tokens: $${provider.getCost()}`);
    
    const result = await provider.embed([testTexts[0]]); // Just test with one text
    
    console.log(`   ✅ SUCCESS!`);
    console.log(`   Model: ${result.model}`);
    console.log(`   Embedding dimensions: ${result.embeddings[0].length}`);
    console.log(`   Usage: ${JSON.stringify(result.usage)}`);
    console.log(`   First 5 values: [${result.embeddings[0].slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
    
    return true;
    
  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}`);
    return false;
  }
}

async function testAllProviders() {
  console.log('🚀 Testing all embedding providers...\n');
  
  const providers = ['nomic', 'openai', 'lmstudio', 'cohere'];
  const results = {};
  
  for (const providerName of providers) {
    results[providerName] = await testSingleProvider(providerName);
    
    // Small delay between provider tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n📊 SUMMARY:');
  Object.entries(results).forEach(([name, success]) => {
    console.log(`   ${success ? '✅' : '❌'} ${name.toUpperCase()}: ${success ? 'Working' : 'Failed'}`);
  });
  
  const workingProviders = Object.entries(results)
    .filter(([name, success]) => success)
    .map(([name]) => name);
  
  if (workingProviders.length > 1) {
    console.log(`\n🔬 Running comparison test with ${workingProviders.length} working providers...`);
    
    const providerInstances = workingProviders.map(name => 
      createEmbeddingProvider(name, rateLimiter)
    );
    
    const comparison = await compareProviders([testTexts[0]], providerInstances);
    
    console.log('\n⚡ PERFORMANCE COMPARISON:');
    Object.entries(comparison).forEach(([name, result]) => {
      if (result.success) {
        console.log(`   ${name}: ${result.dimensions}d, ${result.duration}ms, $${result.cost.toFixed(6)}`);
      }
    });
  }
}

async function main() {
  // Check which providers we can test based on environment variables
  console.log('🔍 Checking available providers...');
  
  const availableProviders = [];
  
  if (process.env.NOMIC_API_KEY) {
    availableProviders.push('Nomic (current)');
  }
  
  if (process.env.OPENAI_API_KEY) {
    availableProviders.push('OpenAI');
  }
  
  if (process.env.COHERE_API_KEY) {
    availableProviders.push('Cohere');
  }
  
  // Check if LM Studio might be running
  try {
    const axios = require('axios');
    await axios.get('http://localhost:1234/v1/models', {
      timeout: 2000,
      headers: { 'Authorization': 'Bearer lm-studio' }
    });
    availableProviders.push('LM Studio (local)');
  } catch (error) {
    // LM Studio not running
  }
  
  console.log('Available providers:', availableProviders.join(', '));
  
  if (availableProviders.length === 0) {
    console.log('\n❌ No providers available. Set API keys or start LM Studio to test.');
    return;
  }
  
  await testAllProviders();
}

// Handle command line arguments
const args = process.argv.slice(2);
if (args.length > 0) {
  const providerName = args[0];
  testSingleProvider(providerName);
} else {
  main();
}

module.exports = { testSingleProvider, testAllProviders };