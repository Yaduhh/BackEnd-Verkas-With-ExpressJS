const os = require('os');

// Log resource utilization (RAM and CPU Cores) - Disabled
function logResourceUsage(label = 'Resource Usage') {
  // No-op to keep console clean
}


// AI API helper client (supports Groq, OpenRouter, and Local AI like Ollama)
async function callOpenRouter(messages) {
  const provider = (process.env.AI_PROVIDER || 'groq').toLowerCase();

  let url;
  let headers = {
    'Content-Type': 'application/json'
  };
  let body = {
    messages: messages,
    temperature: 0.1, // Low temperature for factual consistency
    stream: false
  };

  if (provider === 'router' || provider === '9router' || provider === 'custom' || provider === 'openai') {
    const baseUrl = process.env.AI_BASE_URL || 'https://9router.ngodein.com/v1';
    const apiKey = process.env.AI_API_KEY;
    const modelName = process.env.AI_MODEL || 'ag/gemini-3.7-flash-high';

    if (!apiKey) {
      throw new Error('AI_API_KEY is not defined in .env file.');
    }

    url = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    headers['Authorization'] = `Bearer ${apiKey}`;
    body.model = modelName;
  } else if (provider === 'groq') {
    const apiKey = process.env.GROQ_API_KEY;
    const modelName = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not defined in .env file.');
    }
    url = 'https://api.groq.com/openai/v1/chat/completions';
    headers['Authorization'] = `Bearer ${apiKey}`;
    body.model = modelName;
  } else if (provider === 'local') {
    const localUrl = process.env.LOCAL_AI_URL || 'http://localhost:11434/v1/chat/completions';
    const localModel = process.env.LOCAL_AI_MODEL || 'gemma4:12b';
    url = localUrl;
    body.model = localModel;
  } else {
    const apiKey = process.env.OPENROUTER_API_KEY;
    const modelName = process.env.OPENROUTER_MODEL || 'google/gemma-2-9b-it';

    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not defined in .env file.');
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

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    // Fallback: If returned in SSE stream format like `data: {"id"...}`
    const lines = rawText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:') && trimmed !== 'data: [DONE]') {
        try {
          const parsedChunk = JSON.parse(trimmed.replace(/^data:\s*/, ''));
          if (parsedChunk.choices && parsedChunk.choices[0]?.message?.content) {
            return parsedChunk.choices[0].message.content;
          }
        } catch {}
      }
    }
    throw new Error(`AI API (${provider}) returned unparseable response: ${rawText.slice(0, 200)}`);
  }

  if (!data.choices || data.choices.length === 0) {
    throw new Error(`AI API (${provider}) returned empty choices`);
  }

  return data.choices[0].message.content;
}

module.exports = {
  logResourceUsage,
  callOpenRouter,
  callAI: callOpenRouter
};

