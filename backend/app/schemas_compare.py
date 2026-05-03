from pydantic import BaseModel, Field


class SimilarityRow(BaseModel):
    reference_id: str
    cosine_similarity: float = Field(
        ...,
        description="Cosine similarity vs this reference (unit-normalized MFCC fingerprints).",
    )


class CompareResponse(BaseModel):
    similarities: list[SimilarityRow]
