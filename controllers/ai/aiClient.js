const os = require('os');

// Log resource utilization (RAM and CPU Cores)
function logResourceUsage(label = 'Resource Usage') {
  const memory = process.memoryUsage();
  const rss = (memory.rss / 1024 / 1024).toFixed(1);
  const heapUsed = (memory.heapUsed / 1024 / 1024).toFixed(1);
  const totalSystemRam = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
  const freeSystemRam = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
  const cpuCount = os.cpus().length;

  console.log(`[AI-Service] [${label}]`);
  console.log(`  * CPU Cores Available  : ${cpuCount}`);
  console.log(`  * Total System RAM     : ${totalSystemRam} GB (Free: ${freeSystemRam} GB)`);
  console.log(`  * Process RSS Memory   : ${rss} MB`);
  console.log(`  * JS Heap Used Memory  : ${heapUsed} MB`);
}

// AI API helper client (supports OpenRouter and Local AI like Ollama)
async function callOpenRouter(messages) {
  const provider = process.env.AI_PROVIDER || 'openrouter';

  let url;
  let headers = {
    'Content-Type': 'application/json'
  };
  let body = {
    messages: messages,
    temperature: 0.1 // Low temperature for factual consistency
  };

  if (provider === 'local') {
    const localUrl = process.env.LOCAL_AI_URL || 'http://localhost:11434/v1/chat/completions';
    const localModel = process.env.LOCAL_AI_MODEL || 'gemma4:12b';
    url = localUrl;
    body.model = localModel;
  } else {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const modelName = process.env.OPENROUTER_MODEL || 'google/gemma-2-9b-it';

    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not defined in env.');
    }
    url = 'https://openrouter.ai/api/v1/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['HTTP-Referer'] = 'https://verkas.co';
    headers['X-Title'] = 'Verkas AI Service';
    body.model = modelName;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI API error (${provider}): ${response.status} ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  if (!data.choices || data.choices.length === 0) {
    throw new Error(`AI API (${provider}) returned empty choices`);
  }

  return data.choices[0].message.content;
}

module.exports = {
  logResourceUsage,
  callOpenRouter
};
