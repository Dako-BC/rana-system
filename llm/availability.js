import { API_KEYS, PROVIDER_MODELS, getModel } from './models.js'

async function checkAnthropicAvailability(model) {
    if (!API_KEYS.anthropic) return { available: false, reason: 'API key not set' }
    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'x-api-key': API_KEYS.anthropic,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                model,
                max_tokens: 1,
                messages: [{ role: 'user', content: 'test' }],
            }),
        })
        if (response.status === 200) {
            return { available: true, quota: 'Unknown' } // Anthropic doesn't expose quota easily
        } else if (response.status === 401) {
            return { available: false, reason: 'Invalid API key' }
        } else if (response.status === 429) {
            return { available: false, reason: 'Rate limit exceeded' }
        } else {
            return { available: false, reason: `API error: ${response.status}` }
        }
    } catch (error) {
        return { available: false, reason: `Network error: ${error.message}` }
    }
}

async function checkOpenAIAvailability(model) {
    if (!API_KEYS.openai) return { available: false, reason: 'API key not set' }
    try {
        const response = await fetch('https://api.openai.com/v1/models', {
            headers: { 'Authorization': `Bearer ${API_KEYS.openai}` },
        })
        const data = await response.json()
        const availableModels = data.data.map(m => m.id)
        if (availableModels.includes(model)) {
            // Check usage (simplified, OpenAI has complex billing)
            return { available: true, quota: 'Check dashboard' }
        } else {
            return { available: false, reason: 'Model not available' }
        }
    } catch (error) {
        return { available: false, reason: `Error: ${error.message}` }
    }
}

async function checkGrokAvailability(model) {
    if (!API_KEYS.grok) return { available: false, reason: 'API key not set' }
    // xAI Grok API might not be public yet, placeholder
    return { available: false, reason: 'Grok API not implemented' }
}

async function checkGeminiAvailability(model) {
    if (!API_KEYS.gemini) return { available: false, reason: 'API key not set' }
    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}?key=${API_KEYS.gemini}`)
        if (response.status === 200) {
            return { available: true, quota: 'Check Google AI dashboard' }
        } else {
            return { available: false, reason: `API error: ${response.status}` }
        }
    } catch (error) {
        return { available: false, reason: `Error: ${error.message}` }
    }
}

const availabilityCheckers = {
    anthropic: checkAnthropicAvailability,
    grok: checkGrokAvailability,
    openai: checkOpenAIAvailability,
    gemini: checkGeminiAvailability,
}

async function checkProviderModelAvailability(provider, modelName) {
    const model = getModel(modelName, provider)
    const checker = availabilityCheckers[provider]
    if (!checker) return { available: false, reason: 'Provider not supported' }
    return await checker(model)
}

async function getAllAvailabilities() {
    const results = {}
    for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
        results[provider] = {}
        for (const modelName of models) {
            results[provider][modelName] = await checkProviderModelAvailability(provider, modelName)
        }
    }
    return results
}

export { checkProviderModelAvailability, getAllAvailabilities }
