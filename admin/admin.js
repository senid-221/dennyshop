/* Denny Shop dashboard. Vanilla JS, talks to /api on the same origin. */
(function () {
  "use strict";

  var me = null;
  var draft = { sizes: [], colors: [], repaint: null };
  var state = { orders: [], products: [], reels: [], affiliates: [], users: [], settings: {} };

  /* ---------------- helpers ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(n) {
    var v = Math.round(Number(n) || 0);
    return v.toLocaleString("en-US") + " " + (state.settings["money.currency"] || "RWF");
  }

  function date(v) {
    if (!v) return "";
    var d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) +
      " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  function toast(msg, bad) {
    var t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (bad ? " bad" : "");
    t.hidden = false;
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function api(path, opts) {
    opts = opts || {};
    return fetch(path, {
      method: opts.method || "GET",
      credentials: "same-origin",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var e = new Error(data.error || "Request failed (" + res.status + ")");
          e.status = res.status;
          e.fields = data.fields;
          throw e;
        }
        return data;
      });
    });
  }

  /* ---------------- modal ---------------- */
  function openModal(title, innerHtml, onSubmit, submitLabel) {
    $("#modal_backdrop").hidden = false;
    $("#modal_backdrop").classList.add("is-open");
    var m = $("#modal");
    m.hidden = false;
    m.classList.add("is-open");
    m.innerHTML = '<button type="button" class="modal_x" id="modal_x" aria-label="Close">&times;</button>' +
      '<div class="form_card"><h2>' + esc(title) + "</h2>" + innerHtml.replace('id="modal_form"', 'id="modal_form" class="shop-form"') + "</div>";
    $("#modal_x").addEventListener("click", closeModal);
    var form = $("#modal_form", m);
    if (form) {
      $("#modal_submit", m).addEventListener("click", function () { form.requestSubmit(); });
      form.addEventListener("submit", function (ev) {
        ev.preventDefault();
        var btn = $("#modal_submit", m);
        btn.disabled = true;
        Promise.resolve(onSubmit(form)).then(function () {
          closeModal();
        }).catch(function (e) {
          btn.disabled = false;
          var err = $("#modal_error", m);
          if (err) { err.textContent = e.message; } else { toast(e.message, true); }
        });
      });
    }
    var first = form && form.querySelector("input, select, textarea");
    if (first) first.focus();
  }

  function closeModal() {
    $("#modal").classList.remove("is-open");
    $("#modal").hidden = true;
    $("#modal_backdrop").classList.remove("is-open");
    $("#modal_backdrop").hidden = true;
  }

  function field(name, label, value, type, attrs) {
    return '<label for="f_' + name + '">' + esc(label) + "</label>" +
      '<input id="f_' + name + '" name="' + name + '" type="' + (type || "text") + '" value="' + esc(value) + '" ' + (attrs || "") + ">";
  }

  /* ---------------- boot ---------------- */
  function showLogin() {
    $("#login_view").hidden = false;
    $("#app_view").hidden = true;
  }

  function showApp() {
    $("#login_view").hidden = true;
    $("#app_view").hidden = false;
    $("#who_name").textContent = me.name;
    $("#who_role").textContent = me.role;
    buildTabs();
  }

  function buildTabs() {
    var tabs = [];
    if (me.role === "advertiser") {
      tabs = [["me", "My links & earnings"]];
    } else {
      tabs = [["orders", "Orders"], ["products", "Products"], ["reels", "Reels"], ["affiliates", "Advertisers"]];
      if (me.role === "owner") tabs.push(["team", "Team"], ["settings", "Settings"]);
    }
    var nav = $("#tabs");
    nav.innerHTML = tabs.map(function (t) {
      return '<button type="button" class="tab" data-tab="' + t[0] + '">' + esc(t[1]) + "</button>";
    }).join("");
    $all(".tab", nav).forEach(function (b) {
      b.addEventListener("click", function () { selectTab(b.dataset.tab); });
    });
    selectTab(tabs[0][0]);
  }

  function selectTab(name) {
    $all(".tab").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === name); });
    $all(".panel").forEach(function (p) { p.hidden = (p.id !== "panel_" + name); });
    var titles = { orders: "Orders", products: "Products", reels: "Reels", affiliates: "Advertisers", team: "Team", settings: "Store settings", me: "My links & earnings" };
    var pt = $("#panel_title");
    if (pt) pt.textContent = titles[name] || "Dashboard";
    var load = { orders: loadOrders, products: loadProducts, reels: loadReels, affiliates: loadAffiliates, team: loadTeam, settings: loadSettings, me: loadMe }[name];
    if (load) load().catch(function (e) { toast(e.message, true); });
  }

  /* ---------------- orders ---------------- */
  function loadOrders() {
    var q = new URLSearchParams();
    if ($("#orders_status").value) q.set("status", $("#orders_status").value);
    if ($("#orders_q").value.trim()) q.set("q", $("#orders_q").value.trim());
    if ($("#orders_affiliate").value.trim()) q.set("affiliate", $("#orders_affiliate").value.trim());
    return api("/api/admin/orders?" + q.toString()).then(function (data) {
      state.orders = data.orders;
      $("#orders_count").textContent = data.total + " order" + (data.total === 1 ? "" : "s") + " match";
      var host = $("#orders_list");
      if (!data.orders.length) { host.innerHTML = '<p class="empty">No orders here yet. Every checkout that passes the MoMo reference check lands in this list.</p>'; return; }
      host.innerHTML = data.orders.map(orderRow).join("");
      $all(".js-detail", host).forEach(function (b) {
        b.addEventListener("click", function () { toggleOrder(b.dataset.id, host); });
      });
      $all(".js-status", host).forEach(function (b) {
        b.addEventListener("click", function () {
          api("/api/admin/orders/" + b.dataset.id, { method: "PATCH", body: { status: b.dataset.status } })
            .then(loadOrders).catch(function (e) { toast(e.message, true); });
        });
      });
    });
  }

  function orderRow(o) {
    var actions = "";
    if (o.status !== "confirmed" && o.status !== "delivered" && o.status !== "cancelled") {
      actions += '<button type="button" class="btn sm dark js-status" data-id="' + o.id + '" data-status="confirmed">Confirm</button>';
    }
    if (o.status !== "delivered" && o.status !== "cancelled") {
      actions += '<button type="button" class="btn sm ghost js-status" data-id="' + o.id + '" data-status="delivered">Delivered</button>';
    }
    if (o.status !== "cancelled") {
      actions += '<button type="button" class="btn sm danger js-status" data-id="' + o.id + '" data-status="cancelled">Cancel</button>';
    }
    return '<div class="row"><div class="main">' +
      '<div class="title">' + esc(o.code) + " &middot; " + esc(o.customer_name) + '</div>' +
      '<div class="meta">' + esc(date(o.created_at)) + " &middot; " + esc(o.customer_phone) +
      " &middot; " + esc(o.district || "-") + " &middot; " + Number(o.item_count) + " item(s)" +
      (o.affiliate_code ? " &middot; code " + esc(o.affiliate_code) : "") + "</div>" +
      '<div class="chips"><span class="pill ' + esc(o.status) + '">' + esc(o.status) + "</span>" +
      (o.momo_ref ? '<span class="chip">Ref ' + esc(o.momo_ref) + "</span>" : "") +
      (o.paid_claimed ? '<span class="chip">Says paid</span>' : "") + "</div>" +
      '<div id="od_' + o.id + '"></div>' +
      "</div><div class=\"money\">" + money(o.total) + '</div><div class="side">' +
      '<button type="button" class="btn sm ghost js-detail" data-id="' + o.id + '">Details</button>' + actions +
      "</div></div>";
  }

  function toggleOrder(id, host) {
    var slot = $("#od_" + id);
    if (slot.dataset.open === "1") { slot.innerHTML = ""; slot.dataset.open = "0"; return; }
    return api("/api/admin/orders/" + id).then(function (data) {
      var o = data.order;
      slot.innerHTML = '<div class="detail"><dl>' +
        "<dt>Items</dt><dd>" + data.items.map(function (i) {
          return esc(i.product_name) + " (" + esc(i.size) + " / " + esc(i.color) + ") x" + i.qty + " = " + money(i.unit_price * i.qty);
        }).join("<br>") + "</dd>" +
        "<dt>Subtotal</dt><dd>" + money(o.subtotal) + "</dd>" +
        "<dt>Delivery</dt><dd>" + money(o.delivery_fee) + " - " + esc(o.zone) + "</dd>" +
        "<dt>Total</dt><dd>" + money(o.total) + "</dd>" +
        "<dt>MoMo</dt><dd>" + esc(o.momo_number || "") + " &middot; ref " + esc(o.momo_ref) + "</dd>" +
        "<dt>Phone</dt><dd><a href=\"https://wa.me/" + esc(o.customer_phone) + "\" target=\"_blank\" rel=\"noopener\">" + esc(o.customer_phone) + "</a>" +
        (o.customer_email ? " &middot; " + esc(o.customer_email) : "") + "</dd>" +
        "<dt>Where</dt><dd>" + esc(o.district) + " " + esc(o.sector) + " " + esc(o.landmark) +
        (o.map_url ? ' <a href="' + esc(o.map_url) + '" target="_blank" rel="noopener">open pin</a>' : "") + "</dd>" +
        (o.notes ? "<dt>Note</dt><dd>" + esc(o.notes) + "</dd>" : "") +
        "</dl></div>";
      slot.dataset.open = "1";
    }).catch(function (e) { toast(e.message, true); });
  }

  /* ---------------- products ---------------- */
  function loadProducts() {
    return api("/api/admin/products").then(function (data) {
      state.products = data.products;
      var term = $("#products_q").value.trim().toLowerCase();
      var list = data.products.filter(function (p) {
        return !term || (p.name + " " + p.category + " " + p.sizes.join(" ") + " " + p.colors.map(function (c) { return c.name; }).join(" ")).toLowerCase().indexOf(term) !== -1;
      });
      var host = $("#products_list");
      if (!list.length) { host.innerHTML = '<p class="empty">Nothing matches that search.</p>'; return; }
      host.innerHTML = list.map(productRow).join("");
      $all(".js-edit", host).forEach(function (b) {
        b.addEventListener("click", function () { productForm(findProduct(Number(b.dataset.id))); });
      });
      $all(".js-toggle", host).forEach(function (b) {
        b.addEventListener("click", function () {
          var p = findProduct(Number(b.dataset.id));
          api("/api/admin/products/" + p.id, { method: "PATCH", body: { active: !p.active } })
            .then(function () { toast(p.active ? "Hidden from the shop" : "Back on the shop"); return loadProducts(); })
            .catch(function (e) { toast(e.message, true); });
        });
      });
      $all(".js-del", host).forEach(function (b) {
        b.addEventListener("click", function () {
          if (!confirm("Delete this product? Orders keep their history.")) return;
          api("/api/admin/products/" + b.dataset.id, { method: "DELETE" })
            .then(function (r) { toast(r.hidden ? "It is on past orders, so it was hidden instead" : "Deleted"); return loadProducts(); })
            .catch(function (e) { toast(e.message, true); });
        });
      });
    });
  }

  function findProduct(id) {
    return state.products.filter(function (p) { return p.id === id; })[0];
  }

  function productRow(p) {
    return '<div class="row thumb"><img src="' + esc(p.img) + '" alt="">' +
      '<div class="main"><div class="title">' + esc(p.name) +
      (p.badge ? ' <span class="pill">' + esc(p.badge) + "</span>" : "") +
      (!p.active ? ' <span class="pill off">hidden</span>' : "") + "</div>" +
      '<div class="meta">' + esc(p.category) + " &middot; code " + esc(p.sku || p.id) + "</div>" +
      '<div class="chips">' + p.sizes.map(function (s) { return '<span class="chip">' + esc(s) + "</span>"; }).join("") +
      p.colors.map(function (c) {
        return '<span class="chip"><span class="dot" style="background:' + esc(c.swatch) + '"></span>' + esc(c.name) + "</span>";
      }).join("") + "</div></div>" +
      '<div class="money">' + money(p.price) + '</div><div class="side">' +
      '<button type="button" class="btn sm ghost js-edit" data-id="' + p.id + '">Edit</button>' +
      '<button type="button" class="btn sm ghost js-toggle" data-id="' + p.id + '">' + (p.active ? "Hide" : "Show") + "</button>" +
      (me.role === "owner" ? '<button type="button" class="btn sm danger js-del" data-id="' + p.id + '">Delete</button>' : "") +
      "</div></div>";
  }

  function productForm(p) {
    var isNew = !p;
    p = p || { name: "", category: "men", price: "", image: "images/", badge: "", sku: "", colors: [], sizes: [], active: true };
    var html = '<form id="modal_form"><p class="err" id="modal_error"></p>' +
      '<div class="grid2">' + field("name", "Name", p.name) + field("category", "Category (men, women, kids)", p.category) + "</div>" +
      '<div class="grid2">' + field("price", "Price in " + (state.settings["money.currency"] || "RWF"), p.price, "number") +
      field("badge", "Badge (New, Sale, empty)", p.badge) + "</div>" +
      field("image", "Image path", p.image) +
      field("sku", "Code (optional)", p.sku) +
      '<label>Sizes</label><div class="chips" id="size_chips">' + p.sizes.map(function (s) {
        return '<span class="chip">' + esc(s) + ' <button type="button" data-rm="' + esc(s) + '" data-kind="size" aria-label="Remove size ' + esc(s) + '">&times;</button></span>';
      }).join("") + "</div>" +
      '<div class="grid2" style="margin-top:8px"><div><input id="size_add" placeholder="Add size, e.g. XXL"></div>' +
      '<div><button type="button" class="btn sm ghost" id="size_add_btn">Add size</button></div></div>' +
      '<label>Colours</label><div class="chips" id="color_chips">' + p.colors.map(function (c) {
        return '<span class="chip"><span class="dot" style="background:' + esc(c.swatch) + '"></span>' + esc(c.name) +
          ' <button type="button" data-rm="' + esc(c.name) + '" data-kind="color" aria-label="Remove colour ' + esc(c.name) + '">&times;</button></span>';
      }).join("") + "</div>" +
      '<div class="grid2" style="margin-top:8px"><div><input id="color_add" placeholder="Add colour, e.g. Olive"></div>' +
      '<div><input id="color_swatch" placeholder="#808000" type="text"></div>' +
      '<div><button type="button" class="btn sm ghost" id="color_add_btn">Add colour</button></div></div>' +
      '<div class="btn_row"><button type="button" class="btn" id="modal_submit">' + (isNew ? "Create product" : "Save changes") + "</button></div>" +
      "</form>";

    draft.sizes = p.sizes.slice();
    draft.colors = p.colors.map(function (c) { return { name: c.name, swatch: c.swatch }; });

    openModal(isNew ? "New product" : p.name, html, function () {
      var f = $("#modal_form");
      var body = {
        name: f.name.value.trim(), category: f.category.value.trim(), price: Number(f.price.value),
        image: f.image.value.trim(), badge: f.badge.value.trim(), sku: f.sku.value.trim(),
        sizes: draft.sizes, colors: draft.colors,
      };
      if (isNew) return api("/api/admin/products", { method: "POST", body: body }).then(function () { toast("Product added"); return loadProducts(); });
      return api("/api/admin/products/" + p.id, { method: "PATCH", body: body }).then(function () { toast("Saved"); return loadProducts(); });
    });

    function repaint() {
      $("#size_chips").innerHTML = sizes.map(function (s) {
        return '<span class="chip">' + esc(s) + ' <button type="button" data-rm="' + esc(s) + '" data-kind="size">&times;</button></span>';
      }).join("");
      $("#color_chips").innerHTML = colors.map(function (c) {
        return '<span class="chip"><span class="dot" style="background:' + esc(c.swatch) + '"></span>' + esc(c.name) +
          ' <button type="button" data-rm="' + esc(c.name) + '" data-kind="color">&times;</button></span>';
      }).join("");
    }

    $("#size_add_btn").addEventListener("click", function () {
      var v = $("#size_add").value.trim();
      if (!v) return;
      if (sizes.indexOf(v) === -1) sizes.push(v);
      $("#size_add").value = "";
      repaint();
    });
    $("#color_add_btn").addEventListener("click", function () {
      var v = $("#color_add").value.trim();
      if (!v) return;
      var sw = $("#color_swatch").value.trim() || "#d9d9d9";
      var found = false;
      colors.forEach(function (c) { if (c.name.toLowerCase() === v.toLowerCase()) { c.swatch = sw; found = true; } });
      if (!found) colors.push({ name: v, swatch: sw });
      $("#color_add").value = ""; $("#color_swatch").value = "";
      repaint();
    });
  }

  /* ---------------- reels ---------------- */
  function loadReels() {
    return api("/api/admin/reels").then(function (data) {
      state.reels = data.reels;
      var host = $("#reels_list");
      if (!data.reels.length) {
        host.innerHTML = '<p class="empty">No clips yet. Put a 9:16 video in the reels/ folder and add it here.</p>';
        return;
      }
      host.innerHTML = data.reels.map(function (r) {
        return '<div class="row"><div class="main"><div class="title">' + esc(r.title) +
          (!r.active ? ' <span class="pill off">hidden</span>' : "") + "</div>" +
          '<div class="meta">' + esc(r.src) + " &middot; " + esc(r.consent) + "</div>" +
          '<div class="chips"><span class="chip">' + esc(r.meta) + "</span></div></div>" +
          '<div class="side">' +
          '<button type="button" class="btn sm ghost js-edit" data-id="' + r.id + '">Edit</button>' +
          '<button type="button" class="btn sm ghost js-toggle" data-id="' + r.id + '">' + (r.active ? "Hide" : "Show") + "</button>" +
          '<button type="button" class="btn sm danger js-del" data-id="' + r.id + '">Delete</button>' +
          "</div></div>";
      }).join("");
      $all(".js-edit", host).forEach(function (b) {
        b.addEventListener("click", function () { reelForm(state.reels.filter(function (x) { return x.id === Number(b.dataset.id); })[0]); });
      });
      $all(".js-toggle", host).forEach(function (b) {
        b.addEventListener("click", function () {
          var r = state.reels.filter(function (x) { return x.id === Number(b.dataset.id); })[0];
          api("/api/admin/reels/" + r.id, { method: "PATCH", body: { active: !r.active } })
            .then(loadReels).catch(function (e) { toast(e.message, true); });
        });
      });
      $all(".js-del", host).forEach(function (b) {
        b.addEventListener("click", function () {
          if (!confirm("Remove this reel from the shop?")) return;
          api("/api/admin/reels/" + b.dataset.id, { method: "DELETE" }).then(loadReels).catch(function (e) { toast(e.message, true); });
        });
      });
    });
  }

  function reelForm(r) {
    var isNew = !r;
    r = r || { src: "reels/", poster: "", title: "", meta: "", text: "", link: "/product", link_label: "Shop now", consent: "" };
    var html = '<form id="modal_form"><p class="err" id="modal_error"></p>' +
      field("src", "Clip path", r.src) + field("poster", "Poster image path", r.poster) +
      field("title", "Title", r.title) + field("meta", "Short line (price or delivery)", r.meta) +
      field("text", "Description", r.text) +
      '<div class="grid2">' + field("link", "Link", r.link) + field("link_label", "Link label", r.link_label) + "</div>" +
      field("consent", "Consent note", r.consent, "text", 'placeholder="Shown with Eric\'s OK, 10/11/2026."') +
      '<p class="hint">Only publish a clip of a real person after they have agreed. Leave the consent note so the record is visible.</p>' +
      '<div class="btn_row"><button type="button" class="btn" id="modal_submit">' + (isNew ? "Add reel" : "Save") + "</button></div></form>";
    openModal(isNew ? "Add reel" : r.title, html, function (f) {
      var body = {
        src: f.src.value.trim(), poster: f.poster.value.trim(), title: f.title.value.trim(),
        meta: f.meta.value.trim(), text: f.text.value.trim(), link: f.link.value.trim(),
        link_label: f.link_label.value.trim(), consent: f.consent.value.trim(),
      };
      var req = isNew ? api("/api/admin/reels", { method: "POST", body: body })
        : api("/api/admin/reels/" + r.id, { method: "PATCH", body: body });
      return req.then(function () { toast(isNew ? "Reel added" : "Saved"); return loadReels(); });
    });
  }

  /* ---------------- affiliates ---------------- */
  function loadAffiliates() {
    return api("/api/admin/affiliates").then(function (data) {
      state.affiliates = data.affiliates;
      var host = $("#affiliates_list");
      if (!data.affiliates.length) { host.innerHTML = '<p class="empty">No advertiser accounts yet. Create one to give a commissioner a link code.</p>'; return; }
      host.innerHTML = data.affiliates.map(function (a) {
        return '<div class="row"><div class="main"><div class="title">' + esc(a.name) +
          ' <span class="chip">?ref=' + esc(a.code) + "</span>" +
          (!a.active ? ' <span class="pill off">paused</span>' : "") + "</div>" +
          '<div class="meta">' + esc(a.phone || "no phone") + " &middot; " + Number(a.commission_pct) + "% of goods</div>" +
          '<div class="chips"><span class="chip">' + a.clicks + " clicks</span><span class=\"chip\">" + a.order_count + " orders</span><span class=\"chip\">revenue " + money(a.revenue) + "</span>" +
          '<span class="chip">earned ' + money(a.earned) + "</span></div></div>" +
          '<div class="side">' +
          '<button type="button" class="btn sm ghost js-copy" data-code="' + esc(a.code) + '">Copy link</button>' +
          (me.role === "owner" ? '<button type="button" class="btn sm ghost js-edit" data-id="' + a.id + '">Edit</button>' : "") +
          "</div></div>";
      }).join("");
      $all(".js-copy", host).forEach(function (b) {
        b.addEventListener("click", function () { copy(location.origin + "/r/" + b.dataset.code); });
      });
      $all(".js-edit", host).forEach(function (b) {
        b.addEventListener("click", function () {
          affForm(state.affiliates.filter(function (x) { return x.id === Number(b.dataset.id); })[0]);
        });
      });
    });
  }

  function affForm(a) {
    var isNew = !a;
    a = a || { code: "", name: "", phone: "", commission_pct: 10, email: "", password: "" };
    var html = '<form id="modal_form"><p class="err" id="modal_error"></p>' +
      '<div class="grid2">' + field("code", "Link code (letters, numbers)", a.code) + field("name", "Advertiser name", a.name) + "</div>" +
      '<div class="grid2">' + field("phone", "Phone", a.phone) + field("commission_pct", "Commission percent", a.commission_pct, "number") + "</div>" +
      (isNew ? '<div class="grid2">' + field("email", "Login email (optional)", a.email, "email") + field("password", "Password (optional, 8+)", a.password, "password") + "</div>" +
        '<p class="hint">Email and password together create the advertiser sign-in for the dashboard.</p>' : "") +
      '<div class="btn_row"><button type="button" class="btn" id="modal_submit">' + (isNew ? "Create advertiser" : "Save") + "</button></div></form>";
    openModal(isNew ? "New advertiser" : a.name, html, function (f) {
      var body = {
        name: f.name.value.trim(), phone: f.phone.value.trim(), commission_pct: Number(f.commission_pct.value),
      };
      if (isNew) {
        body.code = f.code.value.trim();
        body.email = f.email.value.trim();
        body.password = f.password.value;
        return api("/api/admin/affiliates", { method: "POST", body: body }).then(function () { toast("Advertiser created"); return loadAffiliates(); });
      }
      body.active = a.active;
      return api("/api/admin/affiliates/" + a.id, { method: "PATCH", body: body }).then(function () { toast("Saved"); return loadAffiliates(); });
    });
  }

  /* ---------------- team ---------------- */
  function loadTeam() {
    return api("/api/admin/users").then(function (data) {
      state.users = data.users;
      var host = $("#team_list");
      host.innerHTML = data.users.map(function (u) {
        return '<div class="row"><div class="main"><div class="title">' + esc(u.name) +
          ' <span class="chip">' + esc(u.role) + "</span>" + (!u.active ? ' <span class="pill off">disabled</span>' : "") + "</div>" +
          '<div class="meta">' + esc(u.email) + (u.affiliate_code ? " &middot; code " + esc(u.affiliate_code) : "") + "</div></div>" +
          '<div class="side">' +
          '<button type="button" class="btn sm ghost js-edit" data-id="' + u.id + '">Edit</button>' +
          '<button type="button" class="btn sm ghost js-pw" data-id="' + u.id + '">New password</button>' +
          '<button type="button" class="btn sm ghost js-active" data-id="' + u.id + '">' + (u.active ? "Disable" : "Enable") + "</button>" +
          "</div></div>";
      }).join("");
      $all(".js-edit", host).forEach(function (b) {
        b.addEventListener("click", function () {
          var u = state.users.filter(function (x) { return x.id === Number(b.dataset.id); })[0];
          userForm(u);
        });
      });
      $all(".js-pw", host).forEach(function (b) {
        b.addEventListener("click", function () { passwordForm(Number(b.dataset.id)); });
      });
      $all(".js-active", host).forEach(function (b) {
        b.addEventListener("click", function () {
          var u = state.users.filter(function (x) { return x.id === Number(b.dataset.id); })[0];
          api("/api/admin/users/" + u.id, { method: "PATCH", body: { active: !u.active } }).then(loadTeam).catch(function (e) { toast(e.message, true); });
        });
      });
    });
  }

  function userForm(u) {
    var isNew = !u;
    u = u || { name: "", email: "", role: "staff", affiliate_id: "" };
    var options = ["staff", "advertiser", "owner"].map(function (r) {
      return '<option value="' + r + '"' + (u.role === r ? " selected" : "") + ">" + r + "</option>";
    }).join("");
    var affOptions = '<option value="">none</option>' + state.affiliates.map(function (a) {
      return '<option value="' + a.id + '"' + (u.affiliate_id === a.id ? " selected" : "") + ">" + esc(a.code) + " - " + esc(a.name) + "</option>";
    }).join("");
    var html = '<form id="modal_form"><p class="err" id="modal_error"></p>' +
      '<div class="grid2">' + field("name", "Name", u.name) + field("email", "Email", u.email, "email") + "</div>" +
      '<div class="grid2"><div><label for="f_role">Role</label><select id="f_role" name="role">' + options + "</select></div>" +
      '<div><label for="f_affiliate_id">Advertiser code</label><select id="f_affiliate_id" name="affiliate_id">' + affOptions + "</select></div></div>" +
      (isNew ? '<div class="grid2">' + field("password", "Password (8+)", "", "password") + "</div>" : "") +
      '<div class="btn_row"><button type="button" class="btn" id="modal_submit">' + (isNew ? "Create account" : "Save") + "</button></div></form>";
    openModal(isNew ? "Add account" : u.name, html, function (f) {
      var body = { name: f.name.value.trim(), email: f.email.value.trim(), role: f.role.value };
      if (f.affiliate_id.value) body.affiliate_id = Number(f.affiliate_id.value);
      if (isNew) {
        body.password = f.password.value;
        return api("/api/admin/users", { method: "POST", body: body }).then(function () { toast("Account created"); return loadTeam(); });
      }
      return api("/api/admin/users/" + u.id, { method: "PATCH", body: body }).then(function () { toast("Saved"); return loadTeam(); });
    });
  }

  function passwordForm(id) {
    var html = '<form id="modal_form"><p class="err" id="modal_error"></p>' +
      field("password", "New password (8+ characters)", "", "password") +
      '<p class="hint">Saving signs that person out of every device.</p>' +
      '<div class="btn_row"><button type="button" class="btn" id="modal_submit">Set password</button></div></form>';
    openModal("Reset password", html, function (f) {
      return api("/api/admin/users/" + id, { method: "PATCH", body: { password: f.password.value } })
        .then(function () { toast("Password updated"); });
    });
  }

  /* ---------------- settings ---------------- */
  var SETTING_FIELDS = [
    ["shop.name", "Shop name"], ["shop.whatsapp", "WhatsApp number (2507XXXXXXXX)"],
    ["shop.phoneDisplay", "Phone as shown on the site"], ["shop.email", "Email"], ["shop.address", "Address line"],
    ["momo.number", "MoMo number"], ["momo.name", "MoMo account name"], ["momo.network", "Network name"],
    ["momo.ussd", "MoMo short code (optional)"], ["money.currency", "Currency code"], ["delivery.freeOver", "Free delivery over (RWF)"]
  ];

  function settingSlug(key) { return key.replace(/\./g, "__"); }

  function loadSettings() {
    return api("/api/admin/settings").then(function (data) {
      state.settings = data.settings;
      var html = '<form id="settings_form" class="form_card shop-form"><p class="err" id="settings_error"></p>' +
        '<h2>Store settings</h2><div class="grid2">' +
        SETTING_FIELDS.map(function (f) { return "<div>" + field(settingSlug(f[0]), f[1], data.settings[f[0]] || "") + "</div>"; }).join("") +
        "</div>" +
        '<label for="f_delivery_zones">Delivery zones (JSON)</label>' +
        '<textarea id="f_delivery_zones" name="delivery_zones">' + esc(data.settings["delivery.zones"]) + "</textarea>" +
        '<p class="hint">Each zone needs a name and a fee in ' + (data.settings["money.currency"] || "RWF") + '.</p>' +
        '<div class="btn_row"><button type="submit" class="btn">Save settings</button></div></form>';
      var host = $("#settings_host");
      host.innerHTML = html;
      $("form", host).addEventListener("submit", function (ev) {
        ev.preventDefault();
        var f = ev.target;
        var body = {};
        SETTING_FIELDS.forEach(function (k) {
          var input = f.elements[settingSlug(k[0])];
          body[k[0]] = input ? String(input.value).trim() : "";
        });
        body["delivery.zones"] = f.elements.delivery_zones.value.trim();
        api("/api/admin/settings", { method: "PUT", body: body })
          .then(function () { toast("Settings saved - the shop picks them up on the next load"); return loadSettings(); })
          .catch(function (e) { $("#settings_error", host).textContent = e.message; });
      });
    });
  }

  /* ---------------- advertiser self view ---------------- */
  function loadMe() {
    return api("/api/affiliate/me").then(function (d) {
      var host = $("#me_view");
      host.innerHTML = '<div class="form_card"><h2>' + esc(d.name) + "</h2>" +
        '<p class="meta">Your link: <strong id="my_link">' + esc(d.link) + "</strong> " +
        '<button type="button" class="btn sm ghost" id="my_copy">Copy</button></p>' +
        '<div class="chips"><span class="chip">' + Number(d.commission_pct) + "% of goods</span>" +
        '<span class="chip">' + d.referred_orders + " orders</span>" +
        '<span class="chip">earned ' + money(d.earned_commission) + "</span></div>" +
        '<h3 style="margin-top:18px">Orders through your link</h3>' +
        (d.orders.length ? '<div class="rows">' + d.orders.map(function (o) {
          return '<div class="row"><div class="main"><div class="title">' + esc(o.code) + "</div>" +
            '<div class="meta">' + esc(date(o.created_at)) + " &middot; " + esc(o.customer_name) + "</div></div>" +
            '<div class="money">' + money(o.total) + '</div><div class="side"><span class="pill ' + esc(o.status) + '">' + esc(o.status) + "</span></div></div>";
        }).join("") + "</div>" : '<p class="empty">No orders yet. Share your link on WhatsApp status.</p>') +
        "</div>";
      $("#my_copy").addEventListener("click", function () { copy(d.link); });
    });
  }

  /* ---------------- clipboard ---------------- */
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Copied"); }, function () { fallbackCopy(text); toast("Copied"); });
    } else { fallbackCopy(text); toast("Copied"); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) { }
    document.body.removeChild(ta);
  }

  /* ---------------- wiring ---------------- */
  $("#login_form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var le = $("#login_error"); le.textContent = ""; le.classList.remove("show");
    api("/api/auth/login", { method: "POST", body: { email: $("#login_email").value.trim(), password: $("#login_password").value } })
      .then(function (u) { me = u; showApp(); })
      .catch(function (e) { var n = $("#login_error"); n.textContent = e.message; n.classList.add("show"); });
  });

  $("#logout_btn").addEventListener("click", function () {
    api("/api/auth/logout", { method: "POST" }).then(function () { location.reload(); });
  });

  $("#modal").addEventListener("click", function (ev) {
    var rm = ev.target.closest("[data-rm]");
    if (rm && draft.repaint) {
      if (rm.dataset.kind === "size") draft.sizes = draft.sizes.filter(function (s) { return s !== rm.dataset.rm; });
      else draft.colors = draft.colors.filter(function (c) { return c.name !== rm.dataset.rm; });
      draft.repaint();
      return;
    }
    if (ev.target.closest("#size_add_btn")) {
      var s = $("#size_add").value.trim();
      if (s && draft.sizes.indexOf(s) === -1) draft.sizes.push(s);
      $("#size_add").value = "";
      if (draft.repaint) draft.repaint();
      return;
    }
    if (ev.target.closest("#color_add_btn")) {
      var name = $("#color_add").value.trim();
      if (!name) return;
      var sw = $("#color_swatch").value.trim() || "#d9d9d9";
      var hit = false;
      draft.colors.forEach(function (c) { if (c.name.toLowerCase() === name.toLowerCase()) { c.swatch = sw; hit = true; } });
      if (!hit) draft.colors.push({ name: name, swatch: sw });
      $("#color_add").value = ""; $("#color_swatch").value = "";
      if (draft.repaint) draft.repaint();
    }
  });

  $("#modal_backdrop").addEventListener("click", closeModal);
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closeModal(); });

  $("#orders_refresh").addEventListener("click", loadOrders);
  ["orders_status", "orders_q", "orders_affiliate"].forEach(function (id) {
    $("#" + id).addEventListener("change", loadOrders);
    $("#" + id).addEventListener("input", function () {
      clearTimeout(this._t);
      var self = this;
      this._t = setTimeout(function () { if (id !== "orders_status") loadOrders().catch(function () { }); }, 350);
      void self;
    });
  });
  $("#products_q").addEventListener("input", function () { loadProducts().catch(function (e) { toast(e.message, true); }); });
  $("#product_new_btn").addEventListener("click", function () { productForm(null); });
  $("#reel_new_btn").addEventListener("click", function () { reelForm(null); });
  $("#aff_new_btn").addEventListener("click", function () { affForm(null); });
  $("#user_new_btn").addEventListener("click", function () { loadTeam().then(function () { userForm(null); }); });

  api("/api/auth/me").then(function (d) {
    if (!d.user) return showLogin();
    me = d.user;
    if (me.role !== "advertiser") {
      api("/api/admin/settings").then(function (s) { state.settings = s.settings; showApp(); }).catch(function () { showLogin(); });
    } else {
      showApp();
    }
  }).catch(function () { showLogin(); });
})();
