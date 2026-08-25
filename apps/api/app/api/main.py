from fastapi import APIRouter

from app.api.routes import (
    admin,
    assets,
    auth,
    chat,
    chat_sessions,
    collab,
    design,
    fonts,
    health,
    image_tools,
    import_image,
    import_jobs,
    design_hydrate_jobs,
    design_export_jobs,
    chat_image_jobs,
    chat_video_jobs,
    chat_audio_jobs,
    chat_lottie_jobs,
    image_process_jobs,
    upload_jobs,
    me,
    mockup,
    notices,
    orgs,
    plaza,
    projects,
    shares,
    uploads,
    users,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(auth.wallet_router, prefix="/wallet", tags=["wallet"])
api_router.include_router(admin.router)
api_router.include_router(me.router)
api_router.include_router(users.router)
api_router.include_router(notices.router)
api_router.include_router(orgs.router)
api_router.include_router(plaza.router)
api_router.include_router(projects.router)
api_router.include_router(shares.router)
api_router.include_router(collab.router)
api_router.include_router(fonts.router)
api_router.include_router(assets.router)
api_router.include_router(uploads.router)
api_router.include_router(upload_jobs.router)
api_router.include_router(chat_sessions.router)
api_router.include_router(import_image.router)
api_router.include_router(import_jobs.router)
api_router.include_router(design_hydrate_jobs.router)
api_router.include_router(design_export_jobs.router)
api_router.include_router(chat_image_jobs.router)
api_router.include_router(chat_video_jobs.router)
api_router.include_router(chat_audio_jobs.router)
api_router.include_router(chat_lottie_jobs.router)
api_router.include_router(chat.router)
api_router.include_router(image_tools.router)
api_router.include_router(image_process_jobs.router)
api_router.include_router(mockup.router)
api_router.include_router(design.router)
