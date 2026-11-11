/* ============================================================
   shop.js - cart, MoMo checkout, payment-reference proof,
   customer locator and WhatsApp order handoff.
   Vanilla JS, no new dependencies. Runs on every page.
   ============================================================ */

var CART_KEY = "denny_cart_v1";
var ORDER_KEY = "denny_last_order_v1";

var gridState = { cat: "all", sort: "featured", q: "" };
var sharedLocation = null;

/* ---------------- money ---------------- */
function fmt(n) {
    var v = Math.round(Number(n) || 0);
    return v.toLocaleString("en-US") + " " + MONEY.currency;
}

/* ---------------- tiny helpers ---------------- */
function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
}

function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

function all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
}

function getProduct(id) {
    for (var i = 0; i < PRODUCTS.length; i++) {
        if (PRODUCTS[i].id === id) return PRODUCTS[i];
    }
    return null;
}

function catLabel(key) {
    for (var i = 0; i < CATEGORIES.length; i++) {
        if (CATEGORIES[i].key === key) return CATEGORIES[i].label;
    }
    return key;
}

/* ---------------- toast ---------------- */
function flash(msg) {
    var t = document.getElementById("shop_toast");
    if (!t) {
        t = el('<div id="shop_toast"></div>');
        t.setAttribute("style", "position:fixed;left:50%;transform:translateX(-50%);bottom:86px;z-index:1200;background:#222;color:#fff;padding:10px 18px;border-radius:30px;font-size:13px;box-shadow:0 6px 18px rgba(0,0,0,.3);opacity:0;transition:opacity .25s;pointer-events:none;max-width:90%;text-align:center;");
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.style.opacity = "0"; }, 2400);
}

/* ---------------- cart ---------------- */
function readCart() {
    try {
        var arr = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        return [];
    }
}

function writeCart(items) {
    try { localStorage.setItem(CART_KEY, JSON.stringify(items)); } catch (e) { /* private mode */ }
}

function addToCart(id, size, color, qty) {
    var p = getProduct(id);
    if (!p) return;
    size = size || (p.sizes && p.sizes[0]) || "";
    color = color || (p.colors && p.colors[0]) || "";
    var items = readCart();
    var found = null;
    for (var i = 0; i < items.length; i++) {
        if (items[i].id === id && items[i].size === size && items[i].color === color) found = items[i];
    }
    if (found) found.qty += (qty || 1);
    else items.push({ id: id, name: p.name, img: p.img, price: p.price, size: size, color: color, qty: qty || 1 });
    writeCart(items);
    paintCart();
    flash("Added to cart: " + p.name + " (" + size + ", " + color + ")");
}

function setQty(index, delta) {
    var items = readCart();
    if (!items[index]) return;
    items[index].qty += delta;
    if (items[index].qty < 1) items.splice(index, 1);
    writeCart(items);
    paintCart();
}

function removeLine(index) {
    var items = readCart();
    items.splice(index, 1);
    writeCart(items);
    paintCart();
}

function clearCart() {
    writeCart([]);
    paintCart();
}

function cartCount() {
    return readCart().reduce(function (n, it) { return n + it.qty; }, 0);
}

function cartSubtotal(items) {
    return (items || readCart()).reduce(function (n, it) { return n + it.price * it.qty; }, 0);
}

function deliveryFeeFor(zoneName, subtotal) {
    if (subtotal >= DELIVERY.freeOver) return 0;
    for (var i = 0; i < DELIVERY.zones.length; i++) {
        if (DELIVERY.zones[i].name === zoneName) return DELIVERY.zones[i].fee;
    }
    return DELIVERY.zones[DELIVERY.zones.length - 1].fee;
}

/* ---------------- cart panel painting ---------------- */
function paintCart() {
    var n = cartCount();
    all(".cart_count").forEach(function (b) {
        b.textContent = n;
        b.style.display = n ? "block" : "none";
    });
    var body = document.getElementById("drawer_body");
    if (body) body.innerHTML = drawerLines();
    var tot = document.getElementById("drawer_totals");
    if (tot) tot.innerHTML = totalsHtml();
    var go = document.getElementById("drawer_checkout");
    if (go) go.disabled = readCart().length === 0;
}

function drawerLines() {
    var items = readCart();
    if (!items.length) {
        return '<div class="drawer_empty">Your cart is empty. Tap Add on any product to start an order.</div>';
    }
    return items.map(function (it, idx) {
        return '<div class="cart_line">' +
            '<img src="' + esc(it.img) + '" alt="' + esc(it.name) + '">' +
            '<div class="cl_info">' +
            '<div class="cl_name">' + esc(it.name) + "</div>" +
            '<div class="cl_meta">' + esc(it.size) + (it.color ? " / " + esc(it.color) : "") + " - " + fmt(it.price) + "</div>" +
            '<div class="cl_price">' + fmt(it.price * it.qty) + "</div>" +
            '<div class="qty">' +
            '<button type="button" data-step="-1" data-idx="' + idx + '" aria-label="Decrease quantity">-</button>' +
            "<span>" + it.qty + "</span>" +
            '<button type="button" data-step="1" data-idx="' + idx + '" aria-label="Increase quantity">+</button>' +
            "</div>" +
            '<button type="button" class="cl_remove" data-rm="' + idx + '">Remove</button>' +
            "</div></div>";
    }).join("");
}

function totalsHtml() {
    var sub = cartSubtotal();
    var zone = currentZone();
    var fee = deliveryFeeFor(zone, sub);
    return '<div class="totals">' +
        "<div><span>Subtotal</span><span>" + fmt(sub) + "</span></div>" +
        "<div><span>Delivery (" + esc(zone) + ")</span><span>" + (fee ? fmt(fee) : "Free") + "</span></div>" +
        '<div class="grand"><span>Total</span><span>' + fmt(sub + fee) + "</span></div>" +
        "</div>";
}

function currentZone() {
    var sel = document.getElementById("drawer_zone");
    return sel && sel.value ? sel.value : DELIVERY.zones[0].name;
}

function openDrawer() {
    ensureChrome();
    document.getElementById("shop_backdrop").classList.add("is-open");
    document.getElementById("shop_drawer").classList.add("is-open");
}

function closeDrawer() {
    var d = document.getElementById("shop_drawer");
    if (d) d.classList.remove("is-open");
    var b = document.getElementById("shop_backdrop");
    if (b) b.classList.remove("is-open");
}

function closeModal() {
    var m = document.getElementById("shop_modal");
    if (m) m.classList.remove("is-open");
}

/* ---------------- links ---------------- */
function waLink(text) {
    return "https://wa.me/" + SHOP.whatsappNumber + "?text=" + encodeURIComponent(text);
}

function mapsUrl(lat, lng) {
    return "https://www.google.com/maps/search/?api=1&query=" + Number(lat).toFixed(5) + "," + Number(lng).toFixed(5);
}

function orderCode() {
    var d = new Date();
    var p = function (x) { return String(x).length < 2 ? "0" + x : String(x); };
    return "DEN-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" +
        Math.random().toString(36).slice(2, 6).toUpperCase();
}

/* ---------------- locator ---------------- */
function askLocation(statusEl, linkEl) {
    if (!navigator.geolocation) {
        statusEl.textContent = "This browser cannot share GPS. Type your district and sector instead.";
        statusEl.className = "loc_status err";
        return;
    }
    statusEl.textContent = "Getting your location...";
    statusEl.className = "loc_status";
    navigator.geolocation.getCurrentPosition(function (pos) {
        sharedLocation = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: Math.round(pos.coords.accuracy)
        };
        statusEl.textContent = "Location captured (accurate to about " + sharedLocation.acc + " m). The seller receives this pin.";
        statusEl.className = "loc_status";
        linkEl.innerHTML = '<a class="loc_map_link" href="' + mapsUrl(sharedLocation.lat, sharedLocation.lng) +
            '" target="_blank" rel="noopener">Open my pin on Google Maps</a>';
    }, function () {
        sharedLocation = null;
        statusEl.textContent = "Location was blocked or unavailable. Fill the district / sector fields so we can still deliver.";
        statusEl.className = "loc_status err";
        linkEl.innerHTML = "";
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
}

/* ---------------- shared chrome (cart + modal + floating buttons) ---------------- */
function ensureChrome() {
    if (document.getElementById("shop_drawer")) return;
    document.body.appendChild(el('<div id="shop_chrome" style="display:contents;">' + chromeHtml() + "</div>"));
    wireChrome();
    paintCart();
}

function chromeHtml() {
    return '' +
        '<div class="shop-backdrop" id="shop_backdrop"></div>' +
        '<aside class="shop-drawer" id="shop_drawer" role="dialog" aria-modal="true" aria-label="Shopping cart">' +
        '<div class="drawer_head"><h4>Your cart</h4>' +
        '<button type="button" class="modal_close" id="drawer_close" aria-label="Close cart">&times;</button></div>' +
        '<div class="drawer_body" id="drawer_body"></div>' +
        '<div class="drawer_foot">' +
        '<label for="drawer_zone" class="drawer_zone_label">Delivery area</label>' +
        '<select id="drawer_zone">' + zoneOptions() + "</select>" +
        '<div id="drawer_totals"></div>' +
        '<button type="button" class="shop-btn" id="drawer_checkout" style="margin-top:10px;">Checkout with MoMo</button>' +
        "</div></aside>" +
        '<div class="shop-modal" id="shop_modal" role="dialog" aria-modal="true" aria-label="Checkout">' +
        '<div class="modal_card" id="modal_card"></div></div>' +
        '<div class="shop-fabs">' +
        '<button type="button" class="fab fab-cart" id="fab_cart" aria-label="Open cart" title="Cart">' +
        '<i class="fa fa-shopping-cart" aria-hidden="true"></i><span class="cart_count" style="display:none;">0</span></button>' +
        '<a class="fab fab-wa" id="fab_wa" aria-label="Chat on WhatsApp" title="WhatsApp" target="_blank" rel="noopener" ' +
        'href="' + waLink("Hello " + SHOP.name + ", I would like to ask about a product.") + '">' +
        '<i class="fa fa-whatsapp" aria-hidden="true"></i></a>' +
        "</div>";
}

function zoneOptions() {
    return DELIVERY.zones.map(function (z) {
        return '<option value="' + esc(z.name) + '">' + esc(z.name) + " - " + fmt(z.fee) + "</option>";
    }).join("");
}

function wireChrome() {
    document.getElementById("drawer_close").addEventListener("click", closeDrawer);
    document.getElementById("shop_backdrop").addEventListener("click", closeDrawer);
    document.getElementById("fab_cart").addEventListener("click", openDrawer);
    document.getElementById("drawer_checkout").addEventListener("click", function () { openCheckout(null); });
    document.getElementById("drawer_zone").addEventListener("change", paintCart);
    document.getElementById("drawer_body").addEventListener("click", function (ev) {
        var t = ev.target;
        if (t.dataset.step) setQty(Number(t.dataset.idx), Number(t.dataset.step));
        else if (t.dataset.rm !== undefined) removeLine(Number(t.dataset.rm));
    });
    document.getElementById("shop_modal").addEventListener("click", function (ev) {
        var copy = ev.target.closest(".copy_btn");
        if (copy) { copyText(copy.dataset.copy, copy); return; }
        if (ev.target === document.getElementById("shop_modal")) closeModal();
    });
    document.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape") { closeDrawer(); closeModal(); }
    });
}

/* ---------------- clipboard ---------------- */
function copyText(text, btn) {
    var done = function () {
        if (!btn) return;
        var old = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = old; }, 1400);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
        fallbackCopy(text);
        done();
    }
}

function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) { }
    document.body.removeChild(ta);
}

/* ---------------- product cards ---------------- */
function swatch(name) {
    return (COLOR_SWATCHES && COLOR_SWATCHES[name]) || COLOR_FALLBACK;
}

function chipRow(p, kind, values) {
    var chips = values.map(function (v) {
        var isColor = kind === "color";
        var cls = "pc_chip" + (isColor ? " pc_sw" : "");
        var inner = isColor
            ? '<span class="sw_dot" style="background:' + swatch(v) + '"></span>' + esc(v)
            : esc(v);
        return '<button type="button" class="' + cls + '" data-kind="' + kind + '" data-val="' + esc(v) +
            '" aria-pressed="false">' + inner + "</button>";
    }).join("");
    return '<div class="pc_group" data-group="' + kind + '">' +
        '<span class="pc_label">' + (kind === "size" ? "Size" : "Colour") + "</span>" +
        '<div class="pc_chips">' + chips + "</div></div>";
}

function cardHtml(p) {
    var badge = p.badge ? '<span class="card_badge">' + esc(p.badge) + "</span>" : "";
    return '<div class="col-sm-6 col-md-4 col-lg-3 product_cell" data-id="' + esc(p.id) +
        '" data-cat="' + esc(p.category) + '" data-price="' + p.price +
        '" data-name="' + esc(p.name.toLowerCase()) + '" data-size="" data-color="">' +
        '<div class="box">' + badge +
        '<div class="card_media">' +
        '<div class="option_container"><div class="options">' +
        '<button type="button" class="option1 js-cart">Add To Cart</button>' +
        '<button type="button" class="option2 js-buy">Buy Now</button>' +
        "</div></div>" +
        '<div class="img-box"><img src="' + esc(p.img) + '" alt="' + esc(p.name) + '"></div>' +
        "</div>" +
        '<div class="detail-box">' +
        '<div class="pc_head"><h5>' + esc(p.name) + "</h5><h6>" + fmt(p.price) + "</h6></div>" +
        chipRow(p, "size", p.sizes || []) +
        chipRow(p, "color", p.colors || []) +
        '<p class="pc_hint" role="status"></p>' +
        '<div class="pc_actions">' +
        '<button type="button" class="pc_add js-cart" aria-label="Add to cart"><i class="fa fa-shopping-cart" aria-hidden="true"></i> Add</button>' +
        '<button type="button" class="pc_buy js-buy">Buy Now</button>' +
        "</div></div></div></div>";
}

/* selection + gate helpers, all state lives on the card element */
function pickChip(cell, btn) {
    var kind = btn.dataset.kind;
    var chips = all(".pc_chip[data-kind=\"" + kind + "\"]", cell);
    chips.forEach(function (c) {
        var on = c === btn;
        c.classList.toggle("is-on", on);
        c.setAttribute("aria-pressed", on ? "true" : "false");
    });
    cell.dataset[kind === "size" ? "size" : "color"] = btn.dataset.val;
    clearHint(cell);
}

function clearHint(cell) {
    var h = q1(".pc_hint", cell);
    if (h) { h.textContent = ""; h.classList.remove("show"); }
    all(".pc_group", cell).forEach(function (g) { g.classList.remove("missing"); });
}

function showHint(cell, missing) {
    var h = q1(".pc_hint", cell);
    if (h) {
        h.textContent = "Choose " + (missing.length === 2 ? "a size and a colour" : "a " + missing[0]);
        h.classList.add("show");
    }
    all(".pc_group", cell).forEach(function (g) {
        g.classList.toggle("missing", missing.indexOf(g.dataset.group) !== -1);
    });
    if (h) h.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function readPick(cell) {
    var missing = [];
    if (!cell.dataset.size) missing.push("size");
    if (!cell.dataset.color) missing.push("color");
    return missing.length ? { missing: missing } : { size: cell.dataset.size, color: cell.dataset.color };
}

function q1(sel, root) { return root.querySelector(sel); }

function visibleProducts() {
    var list = PRODUCTS.filter(function (p) {
        if (gridState.cat !== "all" && p.category !== gridState.cat) return false;
        if (gridState.q) {
            var hay = (p.name + " " + catLabel(p.category) + " " + (p.colors || []).join(" ") + " " + (p.sizes || []).join(" ")).toLowerCase();
            if (hay.indexOf(gridState.q.toLowerCase()) === -1) return false;
        }
        return true;
    });
    if (gridState.sort === "price-asc") list.sort(function (a, b) { return a.price - b.price; });
    else if (gridState.sort === "price-desc") list.sort(function (a, b) { return b.price - a.price; });
    else if (gridState.sort === "name") list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return list;
}

function paintGrid() {
    var host = document.getElementById("product_grid");
    if (!host) return;
    var list = visibleProducts();
    var limit = Number(host.dataset.limit || 0);
    var shown = limit > 0 ? list.slice(0, limit) : list;
    host.innerHTML = shown.map(cardHtml).join("");
    var c = document.getElementById("grid_count");
    if (c) {
        c.textContent = shown.length + " item" + (shown.length === 1 ? "" : "s") +
            (gridState.q ? ' matching "' + gridState.q + '"' : "") +
            (gridState.cat !== "all" ? " in " + catLabel(gridState.cat) : "");
    }
    var more = document.getElementById("grid_more");
    if (more) more.style.display = (limit > 0 && list.length > limit) ? "inline-flex" : "none";
    var empty = document.getElementById("grid_empty");
    if (empty) empty.style.display = shown.length ? "none" : "block";
}

function toolbarHtml() {
    var chips = CATEGORIES.map(function (c) {
        return '<button type="button" class="chip' + (c.key === gridState.cat ? " is-active" : "") +
            '" data-cat="' + c.key + '">' + esc(c.label) + "</button>";
    }).join("");
    return '<div class="shop-toolbar"><div class="shop-chips" id="shop_chips">' + chips + "</div>" +
        '<div class="shop-sort"><label for="shop_sort">Sort</label>' +
        '<select id="shop_sort">' +
        '<option value="featured">Featured</option>' +
        '<option value="price-asc">Price low to high</option>' +
        '<option value="price-desc">Price high to low</option>' +
        '<option value="name">Name A-Z</option>' +
        "</select></div>" +
        '<input class="grid_search" id="grid_search" type="search" placeholder="Search size, colour, item" aria-label="Search products"></div>';
}

function wireToolbar() {
    var chips = document.getElementById("shop_chips");
    if (chips) chips.addEventListener("click", function (ev) {
        var b = ev.target.closest(".chip");
        if (!b) return;
        gridState.cat = b.dataset.cat;
        all(".chip", chips).forEach(function (x) { x.classList.toggle("is-active", x === b); });
        paintGrid();
    });
    var sort = document.getElementById("shop_sort");
    if (sort) {
        sort.value = gridState.sort;
        sort.addEventListener("change", function () { gridState.sort = sort.value; paintGrid(); });
    }
    var search = document.getElementById("grid_search");
    if (search) {
        search.value = gridState.q;
        search.addEventListener("input", function () { gridState.q = search.value.trim(); paintGrid(); });
    }
}

function wireGridEvents(host) {
    host.addEventListener("click", function (ev) {
        var cell = ev.target.closest(".product_cell");
        if (!cell) return;
        var chip = ev.target.closest(".pc_chip");
        if (chip) { pickChip(cell, chip); return; }
        var p = getProduct(cell.dataset.id);
        if (!p) return;
        var wantCart = ev.target.closest(".js-cart");
        var wantBuy = ev.target.closest(".js-buy");
        if (!wantCart && !wantBuy) return;
        var pick = readPick(cell);
        if (pick.missing) { showHint(cell, pick.missing); return; }
        if (wantCart) addToCart(p.id, pick.size, pick.color, 1);
        else buyNow(p.id, pick.size, pick.color);
    });
}

/* Buy Now = one item straight to checkout, cart untouched. */
function buyNow(id, size, color) {
    var p = getProduct(id);
    if (!p) return;
    var item = {
        id: p.id, name: p.name, img: p.img, price: p.price,
        size: size, color: color, qty: 1, direct: true
    };
    ensureChrome();
    openCheckout([item]);
}

/* ---------------- checkout ---------------- */
function openCheckout(items) {
    ensureChrome();
    var order = items && items.length ? items : readCart();
    if (!order.length) { flash("Your cart is empty"); openDrawer(); return; }
    var subtotal = cartSubtotal(order);
    var card = document.getElementById("modal_card");
    card.innerHTML = checkoutHtml();
    document.getElementById("shop_modal").classList.add("is-open");
    renderSummary(order, subtotal);
    wireCheckout(order, subtotal);
}

function checkoutHtml() {
    return '' +
        '<button type="button" class="modal_close" id="ck_close" aria-label="Close checkout">&times;</button>' +
        "<h3>Checkout</h3>" +
        '<p class="modal_sub">Send ' + esc(MOMO.network) + ", then hand us the order and your payment reference on WhatsApp. Nothing is charged on this page.</p>" +
        '<form class="shop-form" id="ck_form" novalidate>' +

        '<div class="step"><div class="step_head"><span class="num">1</span><h4>Your order</h4></div>' +
        '<div class="summary_lines" id="ck_summary"></div></div>' +

        '<div class="step"><div class="step_head"><span class="num">2</span><h4>Your details</h4></div>' +
        '<label for="ck_name">Full name</label>' +
        '<input id="ck_name" type="text" autocomplete="name">' +
        '<p class="field_error" id="e_name">Please enter your full name.</p>' +
        '<div class="row2">' +
        '<div><label for="ck_phone">WhatsApp phone</label>' +
        '<input id="ck_phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="0788123456"></div>' +
        '<div><label for="ck_email">Email (optional)</label>' +
        '<input id="ck_email" type="email" autocomplete="email"></div>' +
        "</div>" +
        '<p class="field_error" id="e_phone">Use a Rwandan mobile number, e.g. 0788123456 or +250788123456.</p></div>' +

        '<div class="step"><div class="step_head"><span class="num">3</span><h4>Where to deliver</h4></div>' +
        '<button type="button" class="shop-btn ghost" id="ck_geo">' +
        '<i class="fa fa-location-arrow" aria-hidden="true"></i> Share my location</button>' +
        '<p class="loc_status" id="ck_geo_status"></p><p id="ck_geo_link"></p>' +
        '<div class="row2">' +
        '<div><label for="ck_district">District</label>' +
        '<input id="ck_district" type="text" placeholder="e.g. Muhanga"></div>' +
        '<div><label for="ck_sector">Sector / Cell</label>' +
        '<input id="ck_sector" type="text" placeholder="e.g. Nyamabuye"></div>' +
        "</div>" +
        '<p class="field_error" id="e_district">Share your location or type the district.</p>' +
        '<label for="ck_landmark">Landmark (optional)</label>' +
        '<input id="ck_landmark" type="text" placeholder="e.g. opposite Muhanga market">' +
        '<label for="ck_zone">Delivery area (sets the fee)</label>' +
        '<select id="ck_zone">' + zoneOptions() + "</select></div>" +

        '<div class="step"><div class="step_head"><span class="num">4</span><h4>Pay with ' + esc(MOMO.network) + "</h4></div>" +
        '<div class="momo_panel">' +
        '<div class="momo_rows">' +
        '<div class="momo_row"><div><div class="mr_label">MoMo number</div>' +
        '<div class="mr_value">' + esc(MOMO.merchantNumber) + "</div></div>" +
        '<button type="button" class="copy_btn" data-copy="' + esc(MOMO.merchantNumber) + '">Copy</button></div>' +
        '<div class="momo_row"><div><div class="mr_label">Account name</div>' +
        '<div class="mr_value">' + esc(MOMO.merchantName) + "</div></div></div>" +
        '<div class="momo_row"><div><div class="mr_label">Amount to send</div>' +
        '<div class="mr_value" id="ck_momo_amt"></div></div>' +
        '<button type="button" class="copy_btn" id="ck_amt_copy">Copy</button></div>' +
        "</div><ol>" +
        "<li>" + (MOMO.ussdCode
            ? 'Dial <strong>' + esc(MOMO.ussdCode) + "</strong> or open the " + esc(MOMO.network) + " menu."
            : "Open the " + esc(MOMO.network) + " menu on the phone you are paying from.") + "</li>" +
        "<li>Choose <strong>Send Money / MoMo Pay</strong> and enter <strong>" + esc(MOMO.merchantNumber) + "</strong>.</li>" +
        "<li>Enter the amount shown above and confirm with your PIN.</li>" +
        "<li>Keep the confirmation SMS. Write its reference in step 5 and attach the receipt in WhatsApp.</li>" +
        "</ol></div></div>" +

        '<div class="step"><div class="step_head"><span class="num">5</span><h4>Payment proof</h4></div>' +
        '<label for="ck_ref">' + esc(MOMO.refLabel) + "</label>" +
        '<input id="ck_ref" type="text" autocomplete="off" placeholder="e.g. 20240611-112233-45678">' +
        '<p class="field_error" id="e_ref">Enter the reference from the ' + esc(MOMO.network) + " confirmation SMS so we can find your payment.</p>" +
        '<p class="proof_hint">' + esc(MOMO.refHint) + "</p>" +
        '<div class="tick_row"><input id="ck_paid" type="checkbox">' +
        '<label for="ck_paid">I have sent the ' + esc(MOMO.network) + " payment.</label></div>" +
        '<p class="field_error" id="e_paid" style="margin-top:-8px;">Tick this once the payment is sent.</p>' +
        '<label for="ck_notes">Note for the seller (optional)</label>' +
        '<textarea id="ck_notes" placeholder="Anything we should know: colour, when someone is home, cash on delivery instead..."></textarea></div>' +

        '<button type="submit" class="shop-btn" id="ck_submit">' +
        '<i class="fa fa-whatsapp" aria-hidden="true"></i> Send order &amp; proof on WhatsApp</button>' +
        '<p class="proof_hint" style="text-align:center;margin-top:12px;">WhatsApp opens with the order already written out. Attach the MoMo receipt screenshot in that chat, then press send.</p>' +
        "</form>";
}

function renderSummary(order, subtotal) {
    var zone = document.getElementById("ck_zone").value;
    var fee = deliveryFeeFor(zone, subtotal);
    var total = subtotal + fee;
    var html = order.map(function (it) {
        return '<div class="sl_row"><span>' + esc(it.name) + " (" + esc(it.size || "-") +
            (it.color ? " / " + esc(it.color) : "") + ") x" + it.qty + "</span><span>" + fmt(it.price * it.qty) + "</span></div>";
    }).join("");
    html += '<div class="sl_row"><span>Delivery - ' + esc(zone) + "</span><span>" + (fee ? fmt(fee) : "Free") + "</span></div>";
    html += '<div class="sl_row total"><span>Total</span><span>' + fmt(total) + "</span></div>";
    document.getElementById("ck_summary").innerHTML = html;
    document.getElementById("ck_momo_amt").textContent = fmt(total);
    var cp = document.getElementById("ck_amt_copy");
    if (cp) cp.dataset.copy = String(total);
}

function wireCheckout(order, subtotal) {
    document.getElementById("ck_close").addEventListener("click", closeModal);
    document.getElementById("ck_zone").addEventListener("change", function () { renderSummary(order, subtotal); });
    document.getElementById("ck_geo").addEventListener("click", function () {
        askLocation(document.getElementById("ck_geo_status"), document.getElementById("ck_geo_link"));
    });
    document.getElementById("ck_form").addEventListener("submit", function (ev) {
        ev.preventDefault();
        submitOrder(order, subtotal);
    });
}

/* ---------------- validation gates ---------------- */
function showErr(id, on) {
    var e = document.getElementById(id);
    if (e) e.classList.toggle("show", !!on);
}

function normalizePhone(raw) {
    var d = String(raw || "").replace(/[^\d]/g, "");
    if (d.indexOf("00250") === 0) d = d.slice(5);
    else if (d.indexOf("250") === 0 && d.length > 9) d = d.slice(3);
    else if (d.charAt(0) === "0") d = d.slice(1);
    if (d.length === 8 && /^[78]/.test(d)) return "250" + d;
    if (/^[78]\d{8}$/.test(d)) return "250" + d;
    return null;
}

function validateCheckout() {
    var ok = true;
    var name = document.getElementById("ck_name").value.trim();
    showErr("e_name", name.length < 3);
    if (name.length < 3) ok = false;

    var phone = normalizePhone(document.getElementById("ck_phone").value);
    showErr("e_phone", !phone);
    if (!phone) ok = false;

    var district = document.getElementById("ck_district").value.trim();
    var noLoc = !district && !sharedLocation;
    showErr("e_district", noLoc);
    if (noLoc) ok = false;

    var ref = document.getElementById("ck_ref").value.trim().replace(/\s+/g, "");
    showErr("e_ref", ref.length < 6);
    if (ref.length < 6) ok = false;

    var paid = document.getElementById("ck_paid").checked;
    showErr("e_paid", !paid);
    if (!paid) ok = false;

    return ok ? { name: name, phone: phone, ref: ref } : null;
}

/* ---------------- the message the seller receives ---------------- */
function buildWaText(o) {
    var L = [];
    L.push("*NEW ORDER - " + SHOP.name.toUpperCase() + "*");
    L.push("Order " + o.code + "  |  " + o.dateStr);
    L.push("");
    L.push("*ITEMS*");
    o.items.forEach(function (it, i) {
        L.push((i + 1) + ". " + it.name + " (" + (it.size || "-") + (it.color ? " / " + it.color : "") + ") x" + it.qty + " = " + fmt(it.price * it.qty));
    });
    L.push("");
    L.push("Subtotal: " + fmt(o.subtotal));
    L.push("Delivery (" + o.zone + "): " + (o.fee ? fmt(o.fee) : "Free"));
    L.push("*TOTAL TO PAY: " + fmt(o.total) + "*");
    L.push("");
    L.push("*CUSTOMER*");
    L.push("Name: " + o.name);
    L.push("Phone: +" + o.phone);
    if (o.email) L.push("Email: " + o.email);
    L.push("");
    L.push("*DELIVERY LOCATION*");
    if (o.mapUrl) L.push("GPS pin (+" + o.acc + " m): " + o.mapUrl);
    L.push("District: " + (o.district || "-"));
    if (o.sector) L.push("Sector / Cell: " + o.sector);
    if (o.landmark) L.push("Landmark: " + o.landmark);
    L.push("");
    L.push("*PAYMENT - " + MOMO.network + "*");
    L.push("Paid to: " + MOMO.merchantNumber + " (" + MOMO.merchantName + ")");
    L.push(MOMO.refLabel + ": " + o.ref);
    L.push("Proof: " + (/attach|screenshot|receipt/i.test(o.notes) ? "receipt screenshot attached in this chat" : "MoMo reference above, screenshot to follow"));
    if (o.notes) { L.push(""); L.push("*NOTE:* " + o.notes); }
    L.push("");
    L.push("Please confirm my order. Thank you.");
    return L.join("\n");
}

function submitOrder(order, subtotal) {
    var v = validateCheckout();
    if (!v) {
        var bad = document.querySelector(".field_error.show");
        if (bad) bad.scrollIntoView({ behavior: "smooth", block: "center" });
        flash("Complete the highlighted fields first");
        return;
    }
    var zone = document.getElementById("ck_zone").value;
    var fee = deliveryFeeFor(zone, subtotal);
    var o = {
        code: orderCode(),
        dateStr: new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        items: order,
        subtotal: subtotal,
        zone: zone,
        fee: fee,
        total: subtotal + fee,
        name: v.name,
        phone: v.phone,
        email: document.getElementById("ck_email").value.trim(),
        district: document.getElementById("ck_district").value.trim() || (sharedLocation ? "Shared by GPS" : ""),
        sector: document.getElementById("ck_sector").value.trim(),
        landmark: document.getElementById("ck_landmark").value.trim(),
        mapUrl: sharedLocation ? mapsUrl(sharedLocation.lat, sharedLocation.lng) : "",
        acc: sharedLocation ? sharedLocation.acc : 0,
        ref: v.ref,
        notes: document.getElementById("ck_notes").value.trim()
    };
    var text = buildWaText(o);
    var url = waLink(text);
    try {
        localStorage.setItem(ORDER_KEY, JSON.stringify({ code: o.code, total: o.total, ref: o.ref, url: url, at: Date.now() }));
    } catch (e) { }
    var win = window.open(url, "_blank");
    var isDirect = o.items.length === 1 && o.items[0].direct;
    if (!isDirect) clearCart();
    closeDrawer();
    showResult(o, url, text, win);
    sharedLocation = null;
}

function showResult(o, url, text, opened) {
    var card = document.getElementById("modal_card");
    card.innerHTML =
        '<button type="button" class="modal_close" id="ck_close2" aria-label="Close">&times;</button>' +
        '<div class="result_box">' +
        '<i class="fa fa-check-circle" aria-hidden="true"></i>' +
        "<h3>Order " + esc(o.code) + " is written out</h3>" +
        '<p class="order_code">' + esc(o.code) + "</p>" +
        "<p>Total <strong>" + fmt(o.total) + "</strong> with " + esc(MOMO.network) + " reference <strong>" + esc(o.ref) + "</strong>.</p>" +
        "<p>" + (opened
            ? "WhatsApp opened with your order. Attach the MoMo receipt screenshot there and press send."
            : "A pop-up blocker stopped WhatsApp. Use the button below.") + "</p>" +
        '<div class="shop-btn-row">' +
        '<a class="shop-btn" href="' + url + '" target="_blank" rel="noopener"><i class="fa fa-whatsapp" aria-hidden="true"></i> Open WhatsApp</a>' +
        '<button type="button" class="shop-btn ghost" id="ck_copy"><i class="fa fa-clipboard" aria-hidden="true"></i> Copy summary</button>' +
        "</div>" +
        '<p class="proof_hint" style="margin-top:16px;">Not paid yet? Send ' + fmt(o.total) + " to " + esc(MOMO.merchantNumber) +
        " (" + esc(MOMO.merchantName) + ") first, then write the " + esc(MOMO.refLabel) + " in the WhatsApp chat.</p>" +
        "</div>";
    document.getElementById("ck_close2").addEventListener("click", closeModal);
    document.getElementById("ck_copy").addEventListener("click", function (ev) { copyText(text, ev.currentTarget); });
}

/* ---------------- contact form -> WhatsApp ---------------- */
function wireContactForm() {
    var f = document.getElementById("contact_form");
    if (!f) return;
    var status = document.getElementById("cf_status");
    var geo = document.getElementById("cf_geo");
    if (geo) geo.addEventListener("click", function () {
        askLocation(document.getElementById("cf_geo_status"), document.getElementById("cf_geo_link"));
    });
    f.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var val = function (n) { var e = f.querySelector('[name="' + n + '"]'); return e ? e.value : ""; };
        var name = val("name").trim();
        var phoneRaw = val("phone");
        var email = val("email").trim();
        var subject = val("subject").trim();
        var district = val("district").trim();
        var msgEl = f.querySelector("textarea");
        var message = msgEl ? msgEl.value.trim() : "";
        var norm = normalizePhone(phoneRaw);
        var err = "";
        if (name.length < 3) err = "Please enter your name.";
        else if (!message) err = "Please write your message.";
        else if (phoneRaw.trim() && !norm) err = "That phone number does not look like a Rwandan number.";
        else if (!norm && !email && !district && !sharedLocation) err = "Give us a phone, email or district so we can reply to you.";
        if (err) { say(status, err, true); return; }
        var L = ["*" + SHOP.name.toUpperCase() + " - " + ((subject || "MESSAGE").toUpperCase()) + "*", "Name: " + name];
        if (norm) L.push("Phone: +" + norm);
        if (email) L.push("Email: " + email);
        if (district) L.push("District: " + district);
        if (sharedLocation) L.push("GPS pin: " + mapsUrl(sharedLocation.lat, sharedLocation.lng));
        L.push("", message);
        var url = waLink(L.join("\n"));
        var win = window.open(url, "_blank");
        say(status, win ? "WhatsApp opened with your message - attach any photo there and press send." : "", false, win ? "" : url);
        if (msgEl) msgEl.value = "";
        sharedLocation = null;
    });
}

function say(node, text, isError, fallbackUrl) {
    if (!node) return;
    if (fallbackUrl) {
        node.className = "loc_status err";
        node.innerHTML = 'WhatsApp was blocked. <a class="loc_map_link" href="' + fallbackUrl + '" target="_blank" rel="noopener">Open the chat here</a>';
        return;
    }
    node.textContent = text;
    node.className = "loc_status" + (isError ? " err" : "");
}

/* ---------------- newsletter ---------------- */
function wireSubscribe() {
    all(".subscribe_form form, .form_sub form").forEach(function (f) {
        f.addEventListener("submit", function (ev) {
            ev.preventDefault();
            var input = f.querySelector('input[type="email"]');
            if (!input) return;
            var v = (input.value || "").trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { flash("Enter a valid email address"); input.focus(); return; }
            window.open(waLink("*Newsletter signup - " + SHOP.name + "*\nEmail: " + v + "\nSend me the offers and new arrivals."), "_blank");
            input.value = "";
            flash("Thanks - your email is with us on WhatsApp");
        });
    });
}

/* ---------------- nav, dead links, query ---------------- */
function wireNav() {
    var cart = document.querySelector(".cart_nav_btn");
    if (cart) cart.addEventListener("click", function (ev) { ev.preventDefault(); openDrawer(); });
    var search = document.querySelector(".nav_search-btn");
    if (search) {
        var form = search.closest("form");
        if (form) form.addEventListener("submit", function (ev) {
            ev.preventDefault();
            location.href = "product.html#search";
        });
    }
    /* the template ships empty hrefs; point them at real destinations */
    all('.slider_section a.btn1[href=""], .arrival_section a[href=""]').forEach(function (a) {
        a.setAttribute("href", "product.html");
    });
    all(".product_section .btn-box a[href=\"\"]").forEach(function (a) {
        a.setAttribute("href", "product.html");
    });
}

function readQuery() {
    var p = new URLSearchParams(location.search);
    if (p.get("cat")) gridState.cat = p.get("cat");
    if (p.get("q")) gridState.q = p.get("q");
    if (p.get("sort")) gridState.sort = p.get("sort");
}

/* ---------------- boot ---------------- */
document.addEventListener("DOMContentLoaded", function () {
    ensureChrome();
    wireNav();
    readQuery();
    var host = document.getElementById("product_grid");
    if (host) {
        var slot = document.getElementById("shop_toolbar_slot");
        if (slot) slot.innerHTML = toolbarHtml();
        wireToolbar();
        paintGrid();
        wireGridEvents(host);
        if (location.hash === "#search") {
            var s = document.getElementById("grid_search");
            if (s) s.focus();
        }
    }
    wireSubscribe();
    wireContactForm();
});
