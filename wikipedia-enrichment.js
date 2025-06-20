const wikipedia = require('wikipedia');
const fs = require('fs');

// Configuration for Wikipedia integration
const WIKIPEDIA_CONFIG = {
  searchTimeout: 10000, // 10 seconds
  maxSections: 10, // Limit sections to avoid huge content
  enableVerification: process.env.WIKIPEDIA_VERIFY === 'true', // Human verification mode
  cacheFile: 'wikipedia_cache.json', // Cache successful matches
  outputFile: process.env.WIKIPEDIA_OUTPUT || 'wikipedia_enriched.json',
};

// Cache for Wikipedia matches to avoid re-searching
let wikipediaCache = {};

// Load existing cache
const loadCache = () => {
  try {
    if (fs.existsSync(WIKIPEDIA_CONFIG.cacheFile)) {
      wikipediaCache = JSON.parse(fs.readFileSync(WIKIPEDIA_CONFIG.cacheFile, 'utf-8'));
      console.log(`📚 Loaded ${Object.keys(wikipediaCache).length} cached Wikipedia matches`);
    }
  } catch (error) {
    console.error('❌ Error loading Wikipedia cache:', error.message);
    wikipediaCache = {};
  }
};

// Save cache
const saveCache = () => {
  try {
    fs.writeFileSync(WIKIPEDIA_CONFIG.cacheFile, JSON.stringify(wikipediaCache, null, 2));
  } catch (error) {
    console.error('❌ Error saving Wikipedia cache:', error.message);
  }
};

// Smart Wikipedia search for movies
const searchMovieWikipedia = async (movie) => {
  const title = movie["Title (Data retrieved 2019-06-21)"];
  const year = movie.Year;
  const director = movie.Director;
  
  // Create cache key
  const cacheKey = `${title}_${year}_${director}`;
  
  // Check cache first
  if (wikipediaCache[cacheKey]) {
    console.log(`💾 Cache hit for: ${title} (${year})`);
    return wikipediaCache[cacheKey];
  }
  
  console.log(`🔍 Searching Wikipedia for: ${title} (${year})`);
  
  try {
    // Try multiple search strategies
    const searchTerms = [
      `${title} ${year} film`,
      `${title} ${year} movie`,
      `${title} film ${director}`,
      `${title} ${director}`,
      title
    ];
    
    for (const searchTerm of searchTerms) {
      try {
        console.log(`   🔎 Trying: "${searchTerm}"`);
        const searchResults = await wikipedia.search(searchTerm, { limit: 5 });
        
        if (searchResults.results.length === 0) continue;
        
        // Try to find the best match
        for (const result of searchResults.results) {
          try {
            const page = await wikipedia.page(result.title);
            const summary = await page.summary();
            
            // Check if this looks like our movie
            if (isMovieMatch(summary, title, year, director)) {
              const matchData = {
                title: result.title,
                url: page.fullurl,
                summary: summary.extract,
                searchTerm: searchTerm,
                confidence: calculateConfidence(summary, title, year, director),
                found: true
              };
              
              // Add to cache
              wikipediaCache[cacheKey] = matchData;
              saveCache();
              
              console.log(`   ✅ Found match: ${result.title} (confidence: ${matchData.confidence})`);
              return matchData;
            }
          } catch (pageError) {
            console.log(`   ⚠️  Error loading page "${result.title}": ${pageError.message}`);
            continue;
          }
        }
      } catch (searchError) {
        console.log(`   ⚠️  Search failed for "${searchTerm}": ${searchError.message}`);
        continue;
      }
    }
    
    // No match found
    const noMatchData = { found: false, title, year, director };
    wikipediaCache[cacheKey] = noMatchData;
    saveCache();
    
    console.log(`   ❌ No Wikipedia match found for: ${title} (${year})`);
    return noMatchData;
    
  } catch (error) {
    console.error(`❌ Wikipedia search error for ${title}: ${error.message}`);
    return { found: false, error: error.message, title, year, director };
  }
};

// Check if Wikipedia page matches our movie
const isMovieMatch = (summary, title, year, director) => {
  const summaryText = summary.extract.toLowerCase();
  const titleLower = title.toLowerCase();
  const yearStr = year.toString();
  const directorLower = director.toLowerCase();
  
  // Must contain the year and some form of "film" or "movie"
  const hasYear = summaryText.includes(yearStr);
  const hasFilmKeyword = summaryText.includes('film') || summaryText.includes('movie');
  const hasDirector = summaryText.includes(directorLower);
  
  // Title matching (allowing for some variation)
  const hasTitle = summaryText.includes(titleLower) || 
                   titleLower.includes(summaryText.split(' ')[0].toLowerCase());
  
  return hasYear && hasFilmKeyword && (hasDirector || hasTitle);
};

// Calculate confidence score for a match
const calculateConfidence = (summary, title, year, director) => {
  let score = 0;
  const summaryText = summary.extract.toLowerCase();
  
  if (summaryText.includes(title.toLowerCase())) score += 40;
  if (summaryText.includes(year.toString())) score += 30;
  if (summaryText.includes(director.toLowerCase())) score += 20;
  if (summaryText.includes('film') || summaryText.includes('movie')) score += 10;
  
  return Math.min(score, 100);
};

// Extract and chunk Wikipedia article content
const extractWikipediaContent = async (wikipediaMatch) => {
  if (!wikipediaMatch.found) return null;
  
  try {
    console.log(`📄 Extracting content from: ${wikipediaMatch.title}`);
    
    const page = await wikipedia.page(wikipediaMatch.title);
    const content = await page.content();
    
    // Extract sections
    const sections = [];
    let currentSection = null;
    
    for (const line of content.split('\n')) {
      if (line.startsWith('==') && line.endsWith('==')) {
        // New section header
        if (currentSection) {
          sections.push(currentSection);
        }
        
        const sectionTitle = line.replace(/=/g, '').trim();
        currentSection = {
          title: sectionTitle,
          content: '',
          wordCount: 0
        };
      } else if (currentSection && line.trim()) {
        // Add content to current section
        currentSection.content += line + ' ';
        currentSection.wordCount = currentSection.content.split(' ').length;
      }
    }
    
    // Add final section
    if (currentSection) {
      sections.push(currentSection);
    }
    
    // Filter and clean sections
    const relevantSections = sections
      .filter(section => section.wordCount > 20) // Minimum word count
      .filter(section => !section.title.toLowerCase().includes('reference')) // Skip references
      .filter(section => !section.title.toLowerCase().includes('external link')) // Skip links
      .slice(0, WIKIPEDIA_CONFIG.maxSections); // Limit sections
    
    console.log(`   📚 Extracted ${relevantSections.length} sections`);
    
    return {
      url: wikipediaMatch.url,
      title: wikipediaMatch.title,
      summary: wikipediaMatch.summary,
      sections: relevantSections,
      totalWordCount: relevantSections.reduce((sum, s) => sum + s.wordCount, 0)
    };
    
  } catch (error) {
    console.error(`❌ Error extracting content from ${wikipediaMatch.title}: ${error.message}`);
    return null;
  }
};

// Human verification prompt (if enabled)
const verifyMatch = async (movie, wikipediaMatch) => {
  if (!WIKIPEDIA_CONFIG.enableVerification || !wikipediaMatch.found) {
    return true; // Auto-approve if verification disabled or no match
  }
  
  console.log(`\n🤔 Please verify this Wikipedia match:`);
  console.log(`Movie: ${movie["Title (Data retrieved 2019-06-21)"]} (${movie.Year}) by ${movie.Director}`);
  console.log(`Wikipedia: ${wikipediaMatch.title}`);
  console.log(`URL: ${wikipediaMatch.url}`);
  console.log(`Summary: ${wikipediaMatch.summary.substring(0, 200)}...`);
  console.log(`Confidence: ${wikipediaMatch.confidence}%`);
  
  // In a real implementation, you'd use readline for interactive prompts
  // For now, we'll auto-approve high confidence matches
  return wikipediaMatch.confidence >= 70;
};

// Main enrichment function
const enrichMovieWithWikipedia = async (movie) => {
  try {
    // Search for Wikipedia article
    const wikipediaMatch = await searchMovieWikipedia(movie);
    
    if (!wikipediaMatch.found) {
      return {
        ...movie,
        wikipedia: { found: false, reason: 'No matching article found' }
      };
    }
    
    // Verify match (if enabled)
    const verified = await verifyMatch(movie, wikipediaMatch);
    
    if (!verified) {
      return {
        ...movie,
        wikipedia: { found: false, reason: 'Failed human verification' }
      };
    }
    
    // Extract full content
    const wikipediaContent = await extractWikipediaContent(wikipediaMatch);
    
    if (!wikipediaContent) {
      return {
        ...movie,
        wikipedia: { found: false, reason: 'Content extraction failed' }
      };
    }
    
    // Return enriched movie data
    return {
      ...movie,
      wikipedia: {
        found: true,
        ...wikipediaContent,
        confidence: wikipediaMatch.confidence,
        verification_status: verified ? 'approved' : 'pending'
      }
    };
    
  } catch (error) {
    console.error(`❌ Error enriching ${movie["Title (Data retrieved 2019-06-21)"]}: ${error.message}`);
    return {
      ...movie,
      wikipedia: { found: false, reason: 'Processing error', error: error.message }
    };
  }
};

// Process multiple movies
const processMoviesWithWikipedia = async (movies, options = {}) => {
  const {
    startIndex = 0,
    batchSize = 5,
    saveProgress = true
  } = options;
  
  console.log(`🚀 Starting Wikipedia enrichment for ${movies.length} movies`);
  console.log(`⚙️  Configuration: verification=${WIKIPEDIA_CONFIG.enableVerification}, cache=${WIKIPEDIA_CONFIG.cacheFile}`);
  
  const enrichedMovies = [];
  let processed = 0;
  
  for (let i = startIndex; i < movies.length; i += batchSize) {
    const batch = movies.slice(i, i + batchSize);
    
    console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1} (${i + 1}-${Math.min(i + batchSize, movies.length)} of ${movies.length})`);
    
    for (const movie of batch) {
      const enrichedMovie = await enrichMovieWithWikipedia(movie);
      enrichedMovies.push(enrichedMovie);
      processed++;
      
      // Add delay to be respectful to Wikipedia
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Save progress after each batch
    if (saveProgress) {
      const progressData = {
        enrichedMovies,
        lastProcessedIndex: i + batchSize,
        metadata: {
          processed: processed,
          total: movies.length,
          timestamp: new Date().toISOString(),
          config: WIKIPEDIA_CONFIG
        }
      };
      
      fs.writeFileSync(WIKIPEDIA_CONFIG.outputFile, JSON.stringify(progressData, null, 2));
      console.log(`💾 Progress saved: ${processed}/${movies.length} movies processed`);
    }
  }
  
  console.log(`\n🎉 Wikipedia enrichment complete!`);
  console.log(`📊 Results: ${enrichedMovies.filter(m => m.wikipedia.found).length} matches found out of ${movies.length} movies`);
  
  return enrichedMovies;
};

// Initialize cache on module load
loadCache();

module.exports = {
  searchMovieWikipedia,
  extractWikipediaContent,
  enrichMovieWithWikipedia,
  processMoviesWithWikipedia,
  WIKIPEDIA_CONFIG
};