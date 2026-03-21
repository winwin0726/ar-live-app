const fs = require('fs');
const dotenv = require('dotenv');
dotenv.config({path: '.env'});
const key = process.env.GEMINI_API_KEY;

if (!key) { 
  console.log('No GEMINI_API_KEY found in .env'); 
  process.exit(1); 
}

fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + key)
  .then(res => res.json())
  .then(data => {
    if (data.models) {
      console.log('Available Models:');
      const genModels = data.models.filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'));
      genModels.forEach(m => console.log(m.name));
    } else {
      console.log('Error from Google:', data);
    }
  })
  .catch(console.error);
