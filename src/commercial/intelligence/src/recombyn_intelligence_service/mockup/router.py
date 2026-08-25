from fastapi import APIRouter

from recombyn_intelligence_service.mockup.routes import auto_bake, bake, batch, render, templates

api_router = APIRouter()
api_router.include_router(templates.router)
api_router.include_router(render.router)
api_router.include_router(batch.router)
api_router.include_router(bake.router)
api_router.include_router(auto_bake.router)
