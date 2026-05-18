import { API_KEYS, PROVIDER_MODELS, DEFAULT_MODEL_BY_PROVIDER, getModel } from './models.js'

const DEFAULT_PROVIDER = 'anthropic'

function buildRoute(provider, modelName) {
    const model = modelName ? getModel(modelName, provider) : DEFAULT_MODEL_BY_PROVIDER[provider]
    return {
        provider,
        model,
        apiKey: API_KEYS[provider],
    }
}

function getModelsForProvider(provider) {
    const models = PROVIDER_MODELS[provider]
    if (!models) {
        throw new Error(`Unknown provider: ${provider}`)
    }
    return models
}

async function chat({ messages, opts = {} } = {}) {
    const provider = opts.provider || DEFAULT_PROVIDER
    const model = opts.model || DEFAULT_MODEL_BY_PROVIDER[provider]

    if (opts.provider) {
        return {
            routeType: 'direct',
            selectedProvider: provider,
            selectedModel: model,
            route: buildRoute(provider, model),
            messages,
            opts,
        }
    }

    if (opts.model) {
        return {
            routeType: 'model',
            selectedProvider: provider,
            selectedModel: opts.model,
            route: buildRoute(provider, opts.model),
            messages,
            opts,
        }
    }

    // No explicit provider or model: return all models for the default provider.
    const models = getModelsForProvider(provider)
    return {
        routeType: 'auto',
        selectedProvider: provider,
        selectedModel: model,
        routes: models.map((modelName) => buildRoute(provider, modelName)),
        messages,
        opts,
    }
}

export { chat }
