from fastapi import APIRouter
from app.api.v1.routes import (auth, dashboard, requisitions, procurement, vendors,
                               invoices, approvals, payments, discounting, reports,
                               admin, notifications, summary, onboarding_public)

router = APIRouter(prefix="/api/v1")
router.include_router(auth.router)
router.include_router(dashboard.router)
router.include_router(requisitions.router)
router.include_router(procurement.router)
router.include_router(vendors.router)
router.include_router(onboarding_public.vendor_onboard)
router.include_router(onboarding_public.public)
router.include_router(invoices.router)
router.include_router(approvals.router)
router.include_router(payments.router)
router.include_router(discounting.router)
router.include_router(reports.router)
router.include_router(admin.router)
router.include_router(notifications.router)
router.include_router(summary.router)
