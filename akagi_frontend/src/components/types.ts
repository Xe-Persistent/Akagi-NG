export interface Recommendation {
    action: string;
    confidence: number;
    consumed?: string[];
}

export interface FullRecommendationData {
    recommendations: Recommendation[];
    tehai: string[];
    last_kawa_tile: string;
}