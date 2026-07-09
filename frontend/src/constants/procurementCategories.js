// Single source of truth for procurement category names. Must exactly match
// Vendor Onboarding's "Add Products You Will Supply" step (VendorKyc.jsx) so
// RFQ vendor matching (backend: vendor_products.category) lines up everywhere:
// vendor product catalog, New Requisition category, RFQ vendor matching, PO display.
export const PROCUREMENT_CATEGORIES = [
  "Stationery & Office Supplies",
  "IT Hardware",
  "Furniture",
  "Electrical & Fixtures",
  "Housekeeping & Consumables",
  "Printing & Branding",
  "Services",
];
