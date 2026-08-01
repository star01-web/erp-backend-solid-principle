/**
 * Shared UOM (Unit of Measure) utilities — single source of truth for
 * conversion + display math across the WHOLE inventory module.
 *
 * Pehle ye logic sirf dispatch.service.js ke andar private methods me tha
 * (_round3 / _uomMatches / _toBaseQuantity). Ab /movement, /bulkmovement,
 * /site-return, DELETE aur display endpoints ko bhi UOM chahiye, isliye
 * yahan extract kiya gaya hai. dispatch.service ab isi ko delegate karta hai.
 *
 * Core rule (Dual UOM): saara stock math BASE uom me hota hai.
 *   uom === base_uom     -> base_quantity = quantity              (factor 1)
 *   uom === purchase_uom -> base_quantity = quantity * conversion_factor
 *   uom missing/null     -> backward-compat: base_uom maan lo     (factor 1)
 *   anything else        -> 400 AppError (unknown unit for this item)
 */
const AppError = require("../../../common/AppError");

/**
 * Canonical 3-dp rounding — the ONE precision used everywhere.
 * Every stock column is DECIMAL(15,3), so all in-memory math must collapse
 * to the same 3 dp grid before compare/store. Without this, binary-float
 * drift (0.1 + 0.2 !== 0.3) slowly desyncs counters from the DB.
 */
const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

// Common UOM alias maps to handle typos (e.g., 'Mettar' -> 'meter', 'mtr' -> 'meter')
const UOM_ALIASES = {
  meter: ["meter", "meters", "metre", "metres", "mtr", "mtrs", "mettar", "m"],
  bundle: ["bundle", "bundles", "bdl", "bdls"],
  pcs: ["pcs", "pc", "piece", "pieces", "nos", "no"],
  kg: ["kg", "kgs", "kilogram", "kilograms"],
  box: ["box", "boxes", "pkt", "packet", "packets"],
};

function normalizeUomString(s) {
  if (!s || typeof s !== "string") return "";
  const cleaned = s.trim().toLowerCase();
  for (const [canonical, aliases] of Object.entries(UOM_ALIASES)) {
    if (aliases.includes(cleaned)) return canonical;
  }
  return cleaned;
}

// Smart UOM compare (case-insensitive & alias-aware, handles typos like 'Mettar' -> 'Meter').
const uomMatches = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const normA = normalizeUomString(a);
  const normB = normalizeUomString(b);
  return normA === normB || a.trim().toLowerCase() === b.trim().toLowerCase();
};

/**
 * Universal UOM normalisation — har movement isi funnel se guzarta hai,
 * validation/stock math se PEHLE.
 *
 * Example (Rope: base 'mtr', purchase 'Bundle', factor 100):
 *   (120, 'mtr')    -> { baseQty: 120, uom: 'mtr',    factor: 1 }
 *   (2,   'Bundle') -> { baseQty: 200, uom: 'Bundle', factor: 100 }
 *   (1.5, 'bundle') -> { baseQty: 150, uom: 'Bundle', factor: 100 }  // case-insensitive
 *   (50,  null)     -> { baseQty: 50,  uom: 'mtr',    factor: 1 }    // backward-compat
 *
 * @param {object} product  base_uom / purchase_uom / conversion_factor / name
 * @param {number} quantity positive magnitude (sign caller handle kare)
 * @param {string} [uom]    entered unit; missing => base_uom
 * @returns {{ baseQty: number, uom: string, factor: number }}
 *   uom yahan NORMALISED hai (product par jo spelling hai wahi), taaki
 *   ledger me consistent value save ho.
 */
function toBaseQuantity(product, quantity, uom) {
  const itemName = product.name || product.id;
  // Backward compat: purane callers uom bhejte hi nahi the — unka number
  // hamesha base UOM tha. Wahi behaviour preserve karo.
  if (uom === undefined || uom === null || String(uom).trim() === "") {
    return {
      baseQty: round3(quantity),
      uom: product.base_uom || product.unit || "pcs",
      factor: 1,
    };
  }

  let baseQty;
  let factor;
  let normalizedUom;
  if (uomMatches(uom, product.base_uom)) {
    // Already in base units — multiply mat karo, warna "120 mtr" ka return
    // double-convert hokar 12000 mtr ban jayega.
    baseQty = round3(quantity);
    factor = 1;
    normalizedUom = product.base_uom;
  } else if (product.purchase_uom && uomMatches(uom, product.purchase_uom)) {
    factor = Number(product.conversion_factor);
    if (!Number.isFinite(factor) || factor <= 0) {
      throw new AppError(
        `Item '${itemName}' has an invalid conversion_factor; cannot convert '${uom}'.`,
        400,
      );
    }
    baseQty = round3(Number(quantity) * factor);
    normalizedUom = product.purchase_uom;
  } else {
    throw new AppError(
      `Invalid uom '${uom}' for item '${itemName}'. Allowed: ` +
        `'${product.base_uom}'${product.purchase_uom ? ` or '${product.purchase_uom}'` : ""}.`,
      400,
    );
  }

  // A movement that rounds to zero (e.g. 0.0004 Bundle) can neither be
  // stored (DECIMAL(15,3)) nor affect stock — reject with a clean message.
  if (baseQty < 0.001) {
    throw new AppError(
      `Quantity is too small: ${quantity} ${uom} converts to less than ` +
        `0.001 ${product.base_uom}.`,
      400,
    );
  }

  return { baseQty, uom: normalizedUom, factor };
}

/**
 * Dual-UOM display string — UI ke liye base total ko full bundles + loose
 * base units me tod deta hai.
 *
 *   445 mtr, factor 100, purchase 'Bundle' -> "4 Bundle & 45 mtr (445 mtr Total)"
 *   400 mtr, factor 100                    -> "4 Bundle (400 mtr Total)"
 *   45 pcs, koi purchase_uom nahi          -> "45 pcs"
 *
 * @param {number} baseTotal total stock in base UOM
 * @param {object} product   base_uom / purchase_uom / conversion_factor / unit
 * @returns {string}
 */
function formatDualStock(baseTotal, product) {
  const total = round3(baseTotal);
  const baseUom = product?.base_uom || product?.unit || "pcs";
  const factor = Number(product?.conversion_factor);

  // Secondary UOM hi nahi, ya factor 1/invalid — plain base display.
  if (!product?.purchase_uom || !Number.isFinite(factor) || factor <= 1) {
    return `${total} ${baseUom}`;
  }

  const fullBundles = Math.floor(total / factor);
  const loose = round3(total - fullBundles * factor);

  if (fullBundles <= 0) return `${total} ${baseUom}`;

  const bundlePart = `${fullBundles} ${product.purchase_uom}`;
  const loosePart = loose > 0 ? ` & ${loose} ${baseUom}` : "";
  return `${bundlePart}${loosePart} (${total} ${baseUom} Total)`;
}

module.exports = { round3, uomMatches, toBaseQuantity, formatDualStock };
