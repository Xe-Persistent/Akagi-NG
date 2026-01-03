export interface Recommendation {
    action: string;
    confidence: number;
    consumed?: string[];
    tile?: string;
}

export interface FullRecommendationData {
    recommendations: Recommendation[];
    tehai: string[];
}