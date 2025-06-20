const { enrichMovieWithWikipedia } = require('./wikipedia-enrichment');

// Test with a famous Criterion movie
const testMovie = {
  "Title (Data retrieved 2019-06-21)": "Mulholland Dr.",
  "Year": "2001",
  "Director": "David Lynch",
  "Description": "Directed by David Lynch • 2001 • United States / / Starring Naomi Watts, Laura Harring, Justin Theroux"
};

async function testWikipediaIntegration() {
  console.log('🧪 Testing Wikipedia integration...');
  console.log('🎬 Test movie:', testMovie["Title (Data retrieved 2019-06-21)"], testMovie.Year);
  
  try {
    const enrichedMovie = await enrichMovieWithWikipedia(testMovie);
    
    console.log('\n📊 Results:');
    console.log('Wikipedia found:', enrichedMovie.wikipedia.found);
    
    if (enrichedMovie.wikipedia.found) {
      console.log('Article title:', enrichedMovie.wikipedia.title);
      console.log('URL:', enrichedMovie.wikipedia.url);
      console.log('Confidence:', enrichedMovie.wikipedia.confidence + '%');
      console.log('Sections found:', enrichedMovie.wikipedia.sections?.length || 0);
      console.log('Total words:', enrichedMovie.wikipedia.totalWordCount);
      
      if (enrichedMovie.wikipedia.sections) {
        console.log('\n📚 Sections:');
        enrichedMovie.wikipedia.sections.forEach((section, i) => {
          console.log(`${i + 1}. ${section.title} (${section.wordCount} words)`);
        });
      }
    } else {
      console.log('Reason:', enrichedMovie.wikipedia.reason);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

testWikipediaIntegration();