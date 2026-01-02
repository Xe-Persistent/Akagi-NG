export interface Recommendation {
    action: string;
    confidence: number;
    consumed?: string[];
}

export interface FullRecommendationData {
    recommendations: Recommendation[];
    tehai: string[];
    is_riichi_declaration?: boolean;
}