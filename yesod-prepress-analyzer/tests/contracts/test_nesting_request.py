import pytest
from pydantic import ValidationError

from app.contracts.nesting import NestingRequest


def payload(**overrides):
    base = {
        "nestingId": "n1",
        "callbackUrl": "https://example.supabase.co/functions/v1/analysis_callback",
        "outputUploadUrl": "https://example.supabase.co/storage/v1/object/upload/sign/pdfs/x.pdf",
        "material": {"widthMm": 1600, "marginMm": 10, "gapMm": 5},
        "rotation": {"allow": True, "stepDegrees": 22.5},
        "cutLines": {"add": True, "name": "CutContour"},
        "items": [
            {
                "key": "job-1",
                "label": "Adesivo",
                "file": {"url": "https://example.supabase.co/storage/v1/object/sign/pdfs/a.pdf"},
                "quantity": 30,
                "fileScale": "1:10 (painel)",
                "bleedMm": 3,
            }
        ],
    }
    base.update(overrides)
    return base


def test_operator_parameters_are_read_from_ticket_notation():
    request = NestingRequest.model_validate(payload())
    assert request.material.length_mm is None  # roll
    assert request.rotation.step_degrees == 22.5
    assert request.items[0].file_scale == 10
    assert request.items[0].quantity == 30


def test_request_survives_the_celery_round_trip():
    request = NestingRequest.model_validate(payload())
    again = NestingRequest.model_validate(request.model_dump(mode="json"))
    assert again == request


def test_material_wider_than_pdf_limit_is_rejected():
    with pytest.raises(ValidationError):
        NestingRequest.model_validate(payload(material={"widthMm": 6000}))
