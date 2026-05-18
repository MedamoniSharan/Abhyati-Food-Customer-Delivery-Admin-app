import { getApiBaseCandidates, PUBLIC_API_BASE_URL } from './apiBase'

export const API_URL = getApiBaseCandidates()[0] ?? PUBLIC_API_BASE_URL

export { PUBLIC_API_BASE_URL, getApiBaseCandidates, logApiCandidatesOnce } from './apiBase'
