import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as path from 'path';

async function testConnection() {
  console.log('--- Testing Gemini API Connection ---');
  
  let apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      const match = envContent.match(/GEMINI_API_KEY=(.*)/);
      if (match && match[1]) apiKey = match[1].trim();
    }
  }

  if (!apiKey || apiKey === '' || apiKey === 'your_gemini_api_key_here') {
    console.error('❌ Error: GEMINI_API_KEY is missing or still set to placeholder in .env');
    process.exit(1);
  }

  try {
    const genAI = new GoogleGenAI({ apiKey });
    
    const modelName = 'gemini-3-flash-preview';
    console.log(`Sending test prompt using model: "${modelName}"`);
    
    // Using the same pattern as ProducerService
    const result = await (genAI as any).models.generateContent({
      model: modelName,
      contents: 'Say hello! This is a connection test for LinterFlow.',
    });
    
    const text = result.text || '';
    
    console.log('\n✅ Success! Gemini responded:');
    console.log(text);
  } catch (error: any) {
    console.error('\n❌ Connection Failed:');
    console.error(error.message);
  }
}

testConnection();
