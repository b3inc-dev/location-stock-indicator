(function () {
  if (window.__lsiIndicatorInit) return;
  window.__lsiIndicatorInit = true;
  function readBoot(el) {
    try { return JSON.parse(el.textContent || "{}"); } catch (e) { return null; }
  }
  function start(bootEl) {
    var boot = readBoot(bootEl);
    if (!boot || !boot.rootId) return;
    if (bootEl.getAttribute("data-lsi-started")) return;
    bootEl.setAttribute("data-lsi-started", "1");

      var rootId = boot.rootId;
      var root = document.getElementById(rootId);
      if (!root) return;

      var bodyEl = root.querySelector(".lsi-body");

      function getTodayDateStr() {
        var d = new Date();
        return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      }
      function sendAnalyticsEvent(eventType, payload) {
        payload = payload || {};
        var q = "action=analytics&event=" + encodeURIComponent(eventType) + "&date=" + encodeURIComponent(getTodayDateStr());
        if (payload.locationId) q += "&locationId=" + encodeURIComponent(payload.locationId);
        if (payload.locationIds && payload.locationIds.length) q += "&locationIds=" + encodeURIComponent(payload.locationIds.join(","));
        fetch("/apps/location-stock?" + q).catch(function () {});
      }

      function refreshCartSections() {
        var sectionIds = ["cart-drawer", "theme-cart-drawer", "cart-icon-bubble", "cart-drawer-wrapper", "main-cart-items"];
        var q = sectionIds.join(",");
        fetch("/?sections=" + q)
          .then(function (r) { return r.json(); })
          .then(function (sections) {
            if (!sections || typeof sections !== "object") return;
            Object.keys(sections).forEach(function (id) {
              var html = sections[id];
              if (typeof html !== "string" || !html) return;
              var el = document.getElementById("shopify-section-" + id);
              if (el) {
                el.innerHTML = html.trim();
                document.dispatchEvent(new CustomEvent("section:refreshed", { detail: { sectionId: id }, bubbles: true }));
              }
            });
          })
          .catch(function () {});
      }

      function updateCartCountInPage(cart) {
        if (!cart || typeof cart.item_count !== "number") return;
        var c = String(cart.item_count);
        var s = "[data-cart-count],.cart-count-bubble,.cart-count,.count-bubble,.header__icon--cart .count,[data-cart-item-count],.js-cart-count,#cart-icon-bubble .count";
        s.split(",").forEach(function (sel) {
          try {
            document.querySelectorAll(sel).forEach(function (el) { el.textContent = c; });
          } catch (e) {}
        });
      }
      function showCartAddedModal(n) {
        var m = root.querySelector(".lsi-cart-m");
        if (!m) return;
        var msgEl = m.querySelector(".lsi-cart-m-msg");
        var bodyEl = m.querySelector(".lsi-cart-m-body");
        var act = m.querySelector(".lsi-cart-m-act");
        if (!msgEl || !act) return;
        var titleTpl = (settings.orderPickModalTitle || "カートに追加しました（{count}点）").replace(/\{count\}/g, typeof n === "number" && n >= 0 ? String(n) : "0");
        msgEl.textContent = titleTpl;
        if (bodyEl) {
          var bodyText = (settings.orderPickModalBody || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          bodyEl.textContent = bodyText;
          bodyEl.style.display = bodyText ? "" : "none";
        }
        var st = buildOrderPickButtonStyle();
        act.innerHTML = '<a href="/cart" class="lsi-cart-m-btn" style="' + st + '">カートを見る</a><button type="button" class="lsi-cart-m-btn" style="' + st + '">買い物を続ける</button>';
        var btn = act.querySelector("button");
        function closeM() {
          m.classList.remove("is-visible");
          m.setAttribute("hidden", "");
        }
        if (btn) btn.addEventListener("click", closeM);
        m.querySelector(".lsi-cart-m-bd").onclick = closeM;
        var closeBtn = m.querySelector(".lsi-cart-m-close");
        if (closeBtn) closeBtn.onclick = closeM;
        m.removeAttribute("hidden");
        m.classList.add("is-visible");
      }

      root.addEventListener("click", function (e) {
        var btn = e.target && e.target.closest ? e.target.closest(".lsi-order-pick-btn") : null;
        if (!btn) return;
        e.preventDefault();
        var locationId = btn.getAttribute("data-location-id") || "";
        var locationName = btn.getAttribute("data-location-name") || "";
        root.dispatchEvent(new CustomEvent("location-stock-order-pick", { detail: { locationId: locationId, locationName: locationName }, bubbles: true }));
        sendAnalyticsEvent("order_pick_click", { locationId: locationId });

        var variantId = root.getAttribute("data-variant-id");
        if (!variantId || !settings.showOrderPickButton) return;

        var originalText = btn.textContent || "";
        var addingLabel = (settings.orderPickAddingLabel || "").trim();
        if (addingLabel) addingLabel = addingLabel.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        var addedLabel = settings.orderPickAddedLabel || "追加しました";

        var btnW = btn.offsetWidth;
        if (btnW > 0) btn.style.minWidth = btnW + "px";
        btn.classList.add("is-loading");
        btn.setAttribute("aria-busy", "true");
        btn.innerHTML = '<span class="lsi-order-pick-btn-spinner" aria-hidden="true"></span>' + addingLabel;
        if (typeof btn.disabled !== "undefined") btn.disabled = true;

        fetch("/cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: [{ id: variantId, quantity: 1 }] }),
        })
          .then(function (res) { return res.json(); })
          .then(function (data) {
            if (data.status && data.status !== 200) {
              btn.classList.remove("is-loading");
              btn.removeAttribute("aria-busy");
              btn.style.minWidth = "";
              btn.textContent = originalText;
              if (typeof btn.disabled !== "undefined") btn.disabled = false;
              return;
            }
            if (settings.orderPickRedirectToCheckout) {
              window.location.href = "/checkout";
              return;
            }
            btn.classList.remove("is-loading");
            btn.classList.add("is-added");
            btn.setAttribute("aria-busy", "false");
            btn.textContent = addedLabel;
            if (typeof btn.disabled !== "undefined") btn.disabled = false;

            fetch("/cart.js")
              .then(function (r) { return r.json(); })
              .then(function (cart) {
                document.dispatchEvent(new CustomEvent("cart:refresh", { detail: { cart: cart }, bubbles: true }));
                document.dispatchEvent(new CustomEvent("location-stock:cart-added", { detail: { cart: cart }, bubbles: true }));
                updateCartCountInPage(cart);
                refreshCartSections();
                showCartAddedModal(cart && cart.item_count);
              })
              .catch(function () {});
            setTimeout(function () {
              btn.classList.remove("is-added");
              btn.style.minWidth = "";
              btn.textContent = originalText;
            }, 2000);
          })
          .catch(function () {
            btn.classList.remove("is-loading");
            btn.removeAttribute("aria-busy");
            btn.style.minWidth = "";
            btn.textContent = originalText;
            if (typeof btn.disabled !== "undefined") btn.disabled = false;
          });
      });

      function setMessage(type, text) {
        bodyEl.classList.remove("lsi-message--loading", "lsi-message--error", "lsi-message--empty");

        if (type) {
          bodyEl.classList.add("lsi-message--" + type);
        }

        bodyEl.textContent = text || "";
      }

      var settings = {
        outOfStockMax: 0,
        inStockMin: 5,
        rowContentMode: "symbol_and_quantity",
        quantityLabel: "在庫",
        quantityWrapperBefore: "(",
        quantityWrapperAfter: ")",
        labelInStock: "在庫あり",
        labelLowStock: "残りわずか",
        labelOutOfStock: "在庫なし",
        loadingMessage: "在庫を読み込み中...",
        emptyMessage: "現在、この商品の店舗在庫はありません。",
        errorMessage: "在庫情報の取得に失敗しました。時間をおいて再度お試しください。",
        layoutType: boot.layoutType,
        sortBy: "config_order",
        pinnedLocationId: null,
        locationsMode: "all",
        usePublicLocationName: false,
        clickAction: "none",
        mapUrlTemplate: "https://maps.google.com/?q={location_name}",
        urlTemplate: "/pages/store-{location_id}",
        showLocationLinks: false,
        inStockColor: boot.inStockColor,
        lowStockColor: boot.lowStockColor,
        outOfStockColor: boot.outOfStockColor,
        locationColWidth: boot.locationColWidth,
        symbolInStock: "◯",
        symbolLowStock: "△",
        symbolOutOfStock: "✕",
        listSeparator: "： ",
        showLegend: true,
        showNotice: false,
        legendPosition: boot.legendPosition,
        noticePosition: boot.noticePosition,
        noticeText: "",
        noticeAlign: boot.noticeAlign,
        noticeMargin: boot.rowPaddingY,
        groupByRegion: false,
        regionAccordionEnabled: false,
        nearbyFirstEnabled: false,
        nearbyOtherCollapsible: false,
        nearbyHeading: "",
        nearbyOtherHeading: "",
        showOrderPickButton: false,
        orderPickButtonLabel: "この店舗で受け取る",
        orderPickAddingLabel: "",
        orderPickAddedLabel: "追加しました",
        orderPickOutOfStockLabel: "Sold Out",
        orderPickModalTitle: "カートに追加しました（{count}点）",
        orderPickModalBody: "チェックアウトページでお届け先を「受取」を選択して受取ご希望の店舗をご選択ください。",
        regionGroupOrder: [],
        accordionIcon: boot.accordionIcon,
        regionUnsetLabel: "その他",
        orderPickRedirectToCheckout: false,
        themeRegionHeadingStyle: {
          backgroundColor: boot.regionHeadingBackground,
          color: boot.regionHeadingColor,
          fontSize: boot.regionHeadingFontSize,
          padding: boot.regionHeadingPadding
        },
        regionHeadingAlign: boot.regionHeadingAlign,
        orderPickBtnStyle: boot.orderPickBtnStyle,
        orderPickBtnAlign: boot.orderPickBtnAlign,
        orderPickColWidth: boot.orderPickColWidth,
        orderPickBtnPadding: boot.orderPickBtnPadding,
        orderPickBtnFontSize: boot.orderPickBtnFontSize,
        orderPickBtnBackground: boot.orderPickBtnBackground,
        orderPickBtnColor: boot.orderPickBtnColor
      };

      function updateLegendElements() {
        var legends = root.querySelectorAll(".lsi-legend");
        if (!legends.length) return;

        var text =
          settings.symbolInStock + " " + (settings.labelInStock || "") +
          " / " +
          settings.symbolLowStock + " " + (settings.labelLowStock || "") +
          " / " +
          settings.symbolOutOfStock + " " + (settings.labelOutOfStock || "");

        legends.forEach(function (el) {
          el.textContent = text;
        });
      }

      function updateNoticeElements() {
        var notices = root.querySelectorAll(".lsi-notice");
        if (!notices.length) return;

        var text = settings.noticeText || "";
        notices.forEach(function (el) {
          el.textContent = text;
        });
      }

      function applyLegendNoticeVisibility() {
        var legendPos = settings.legendPosition || "bottom";
        var noticePos = settings.noticePosition || "bottom";
        root.querySelectorAll("[data-role=\"legend\"]").forEach(function (el) {
          var pos = el.getAttribute("data-legend-position") || "";
          el.style.display = (settings.showLegend && pos === legendPos) ? "" : "none";
        });
        root.querySelectorAll("[data-role=\"notice\"]").forEach(function (el) {
          var pos = el.getAttribute("data-notice-position") || "";
          el.style.display = (settings.showNotice && pos === noticePos) ? "" : "none";
        });
      }

      function getStatusSymbolAndLabel(qty) {
        var outMax = settings.outOfStockMax;
        var inMin = settings.inStockMin;

        var symbol, label;

        if (qty <= outMax) {
          symbol = settings.symbolOutOfStock;
          label = settings.labelOutOfStock;
        } else if (qty >= inMin) {
          symbol = settings.symbolInStock;
          label = settings.labelInStock;
        } else {
          symbol = settings.symbolLowStock;
          label = settings.labelLowStock;
        }

        return { symbol: symbol, label: label };
      }

      function buildQuantityHtml(qty) {
        var mode = settings.rowContentMode;

        if (mode === "symbol_only") {
          return "";
        }

        var useQty =
          mode === "symbol_and_quantity" ||
          mode === "symbol_quantity_label" ||
          mode === "quantity_only" ||
          mode === "quantity_label";

        if (!useQty) return "";

        var inner;

        if (mode === "quantity_label" && settings.quantityLabel) {
          inner = settings.quantityLabel + " " + qty;
        } else {
          inner = qty;
        }

        var before = settings.quantityWrapperBefore || "";
        var after = settings.quantityWrapperAfter || "";

        return (
          '<span class="lsi-qty">' +
            before + inner + after +
          "</span>"
        );
      }

      function applyClickAction(location, displayName) {
        var name = displayName || location.locationName || "";

        if (settings.showLocationLinks && location.linkUrl && String(location.linkUrl).trim() !== "") {
          var rawUrl = String(location.linkUrl).trim();
          var safeUrl = rawUrl.replace(/"/g, "&quot;").replace(/</g, "&lt;");
          var ext = rawUrl.indexOf("http") === 0 ? ' target="_blank" rel="noopener noreferrer"' : "";
          return '<a href="' + safeUrl + '"' + ext + '>' + name + '</a>';
        }

        if (settings.clickAction === "open_map") {
          var url = settings.mapUrlTemplate.replace("{location_name}", encodeURIComponent(name));
          return '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + name + '</a>';
        }

        if (settings.clickAction === "open_url") {
          var url = settings.urlTemplate
            .replace("{location_id}", encodeURIComponent(location.id || ""))
            .replace("{location_name}", encodeURIComponent(name));
          return '<a href="' + url + '">' + name + '</a>';
        }

        return name;
      }

      function filterLocations(stocks) {
        var mode = settings.locationsMode;

        if (mode === "online_only") {
          return stocks.filter(function (s) {
            return !!s.fulfillOnline || !!s.fulfillOnlineOrders || !!s.fulfillsOnlineOrders;
          });
        }

        if (mode === "custom_from_app") {
          return stocks.filter(function (s) {
            return !!s.fromConfig;
          });
        }

        return stocks;
      }

      function sortByDistance(stocks, userLat, userLng) {
        if (!stocks || !userLat || !userLng) return stocks ? stocks.slice() : [];
        function dist(lat, lng) {
          if (lat == null || lng == null) return Infinity;
          var dlat = lat - userLat, dlng = lng - userLng;
          return dlat * dlat + dlng * dlng;
        }
        var out = stocks.slice();
        out.sort(function (a, b) {
          return dist(a.latitude, a.longitude) - dist(b.latitude, b.longitude);
        });
        return out;
      }

      function sortLocations(stocks) {
        var sortBy = settings.sortBy || "config_order";
        var pinnedId = settings.pinnedLocationId || null;

        var pinned = null;
        var rest = stocks ? stocks.slice() : [];
        if (pinnedId && rest.length) {
          for (var i = 0; i < rest.length; i++) {
            if (rest[i].locationId === pinnedId) {
              pinned = rest[i];
              rest.splice(i, 1);
              break;
            }
          }
        }

        if (
          sortBy === "config_order" ||
          sortBy === "none" ||
          !sortBy
        ) {
          if (pinned) return [pinned].concat(rest);
          return rest.length ? rest : stocks;
        }

        if (sortBy === "location_name_asc") {
          rest.sort(function (a, b) {
            var an = a.displayName || a.locationName || "";
            var bn = b.displayName || b.locationName || "";
            return an.localeCompare(bn);
          });
        } else if (sortBy === "quantity_desc") {
          rest.sort(function (a, b) {
            return (b.quantity || 0) - (a.quantity || 0);
          });
        } else if (sortBy === "quantity_asc") {
          rest.sort(function (a, b) {
            return (a.quantity || 0) - (b.quantity || 0);
          });
        } else if (sortBy === "in_stock_first") {
          var outMax = settings.outOfStockMax;
          var inMin = settings.inStockMin;
          function stockOrder(qty) {
            if (qty <= outMax) return 0;
            if (qty >= inMin) return 2;
            return 1;
          }
          rest.sort(function (a, b) {
            return stockOrder(b.quantity || 0) - stockOrder(a.quantity || 0);
          });
        } else if (sortBy === "store_pickup_first") {
          rest.sort(function (a, b) {
            var ap = a.storePickupEnabled ? 1 : 0;
            var bp = b.storePickupEnabled ? 1 : 0;
            return bp - ap;
          });
        } else if (sortBy === "shipping_first") {
          rest.sort(function (a, b) {
            var ap = a.hasShipping ? 1 : 0;
            var bp = b.hasShipping ? 1 : 0;
            return bp - ap;
          });
        } else if (sortBy === "local_delivery_first") {
          rest.sort(function (a, b) {
            var ap = a.hasLocalDelivery ? 1 : 0;
            var bp = b.hasLocalDelivery ? 1 : 0;
            return bp - ap;
          });
        }

        if (pinned) return [pinned].concat(rest);
        return rest;
      }

      function buildStatusHtml(item, status) {
        var color = null;
        if (status.symbol === settings.symbolInStock && settings.inStockColor) color = settings.inStockColor;
        if (status.symbol === settings.symbolLowStock && settings.lowStockColor) color = settings.lowStockColor;
        if (status.symbol === settings.symbolOutOfStock && settings.outOfStockColor) color = settings.outOfStockColor;

        var symbolHtml =
          '<span class="lsi-status-symbol"' +
          (color ? ' style="color:' + color + ';"' : '') +
          ">" +
          status.symbol +
          "</span>";

        var qtyHtml = buildQuantityHtml(item.quantity || 0);
        var labelHtml = status.label
          ? ' <span class="lsi-status-label">' +
              status.label +
            "</span>"
          : "";

        var mode = settings.rowContentMode;
        var parts = [];

        if (mode === "symbol_only") {
          parts.push(symbolHtml);
        } else if (mode === "symbol_and_quantity") {
          parts.push(symbolHtml);
          if (qtyHtml) parts.push(" " + qtyHtml);
        } else if (mode === "symbol_quantity_label") {
          parts.push(symbolHtml);
          if (qtyHtml) parts.push(" " + qtyHtml);
          if (labelHtml) parts.push(" " + labelHtml);
        } else if (mode === "quantity_only") {
          if (qtyHtml) parts.push(qtyHtml);
        } else if (mode === "quantity_label") {
          if (qtyHtml) parts.push(qtyHtml);
          if (labelHtml) parts.push(" " + labelHtml);
        } else {
          parts.push(symbolHtml);
          if (qtyHtml) parts.push(" " + qtyHtml);
        }

        return parts.join("");
      }

      function buildOrderPickButtonStyle() {
        var kind = settings.orderPickBtnStyle || "solid_round";
        if (kind === "simple" || kind === "accent" || kind === "solid" || kind === "outline" || kind === "round" || kind === "pill" || kind === "ghost_square") {
          if (kind === "solid" || kind === "simple" || kind === "accent") kind = "solid_round";
          else if (kind === "outline") kind = "outline_round";
          else if (kind === "ghost_square") kind = "ghost";
        }
        var bg = (settings.orderPickBtnBackground && String(settings.orderPickBtnBackground).trim()) ? String(settings.orderPickBtnBackground).trim() : "";
        var fg = (settings.orderPickBtnColor && String(settings.orderPickBtnColor).trim()) ? String(settings.orderPickBtnColor).trim() : "";
        var pad = (typeof settings.orderPickBtnPadding === "number" && settings.orderPickBtnPadding >= 0) ? settings.orderPickBtnPadding : 8;
        var radius = "4px";
        if (kind === "solid_round" || kind === "outline_round") radius = "8px";
        if (kind === "solid_pill" || kind === "outline_pill") radius = "999px";
        if (kind === "solid_square" || kind === "outline_square") radius = "0";
        if (kind === "ghost") radius = "4px";
        var defaultBg = "#f5f5f5";
        var defaultFg = "#333";
        var parts = [];
        if (kind === "ghost") {
          parts.push("background:transparent");
          parts.push("border:1px solid transparent");
          parts.push("color:" + (fg || defaultFg).replace(/"/g, "&quot;"));
        } else if (kind.indexOf("outline") === 0) {
          var borderColor = fg || defaultFg;
          parts.push("background:transparent");
          parts.push("border:1px solid " + borderColor.replace(/"/g, "&quot;"));
          parts.push("color:" + (fg || defaultFg).replace(/"/g, "&quot;"));
        } else {
          parts.push("background:" + (bg || defaultBg).replace(/"/g, "&quot;"));
          parts.push("border:none");
          parts.push("color:" + (fg || defaultFg).replace(/"/g, "&quot;"));
        }
        parts.push("border-radius:" + radius);
        parts.push("padding:" + pad + "px " + (pad * 1.5) + "px");
        var fs = (typeof settings.orderPickBtnFontSize === "number" && settings.orderPickBtnFontSize >= 12 && settings.orderPickBtnFontSize <= 24) ? settings.orderPickBtnFontSize : 14;
        parts.push("font-size:" + fs + "px");
        parts.push("display:inline-block");
        parts.push("text-decoration:none");
        return parts.join(";");
      }
      function buildOrderPickButton(item) {
        if (!settings.showOrderPickButton) return "";
        if (!item) return "";
        if (!item.storePickupEnabled) return "";
        var qty = typeof item.quantity === "number" ? item.quantity : parseInt(item.quantity, 10) || 0;
        var outMax = typeof settings.outOfStockMax === "number" ? settings.outOfStockMax : 0;
        if (qty <= outMax) {
          var outLabel = (settings.orderPickOutOfStockLabel || "Sold Out").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          var btnStyle = buildOrderPickButtonStyle();
          return '<span class="lsi-order-pick-out" style="' + btnStyle + '">' + outLabel + "</span>";
        }
        if (!settings.orderPickButtonLabel) return "";
        var label = settings.orderPickButtonLabel.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        var btnStyle = buildOrderPickButtonStyle();
        var align = settings.orderPickBtnAlign || "right";
        var locId = (item.locationId || "").replace(/"/g, "&quot;");
        var locName = (item.displayName || item.locationName || "").replace(/"/g, "&quot;");
        var cls = "lsi-order-pick-btn lsi-order-pick-btn--" + (align || "right");
        if (settings.orderPickRedirectToCheckout) {
          return '<a href="/checkout" class="' + cls + '" data-location-id="' + locId + '" data-location-name="' + locName + '" style="' + btnStyle + '">' + label + "</a>";
        }
        return '<button type="button" class="' + cls + '" data-location-id="' + locId + '" data-location-name="' + locName + '" style="' + btnStyle + '">' + label + "</button>";
      }

      function groupStocksByRegion(stocks, order) {
        var map = {};
        stocks.forEach(function (item) {
          var key = item.regionKey || item.locationName || "未設定";
          if (!map[key]) map[key] = { regionKey: key, items: [] };
          map[key].items.push(item);
        });
        if (order && order.length) {
          var result = [];
          order.forEach(function (name) {
            if (map[name] && map[name].items.length) result.push(map[name]);
          });
          Object.keys(map).forEach(function (k) {
            if (order.indexOf(k) === -1) result.push(map[k]);
          });
          return result;
        }
        return Object.keys(map).sort().map(function (k) { return map[k]; });
      }

      var savedTableHtml = null;
      function adjustTableColumnWidthsForMobile() {
        if (settings.layoutType !== "table" || !settings.showOrderPickButton) return;
        var table = root.querySelector(".lsi-table");
        if (!table) return;
        var colgroup = table.querySelector("colgroup");
        if (!colgroup || !colgroup.children) return;
        var colCount = colgroup.children.length;
        var locShare = Math.min(95, Math.max(5, Number(settings.locationColWidth) || 70));
        var origBtn = Math.min(50, Math.max(15, Number(settings.orderPickColWidth) || 25));
        var remaining = 100 - origBtn;
        var origLoc = remaining * (locShare / 100);
        var origStatus = remaining * ((100 - locShare) / 100);
        var doc = root.ownerDocument || document;
        var vw = (doc.documentElement && doc.documentElement.clientWidth) || (doc.defaultView && doc.defaultView.innerWidth) || 768;
        if (vw > 768) {
          if (savedTableHtml) {
            table.innerHTML = savedTableHtml;
            savedTableHtml = null;
            colgroup = table.querySelector("colgroup");
          }
          if (colgroup && colgroup.children.length === 3) {
            var cols = colgroup.children;
            cols[0].style.width = origLoc + "%";
            cols[1].style.width = origStatus + "%";
            cols[2].style.width = origBtn + "%";
          }
          return;
        }
        if (colCount === 2) return;
        var btn = root.querySelector(".lsi-order-pick-btn");
        if (!btn) return;
        var tableWidth = table.getBoundingClientRect().width;
        if (tableWidth <= 0) return;
        var padX = parseInt(root.getAttribute("data-table-row-padding-x"), 10);
        if (isNaN(padX) || padX < 0) padX = 12;
        var cellPadH = padX * 2;
        var buttonWidth = btn.getBoundingClientRect().width;
        var currentBtnColPx = tableWidth * (origBtn / 100);
        var currentContentPx = currentBtnColPx - cellPadH;
        if (buttonWidth <= currentContentPx) {
          colgroup.children[0].style.width = origLoc + "%";
          colgroup.children[1].style.width = origStatus + "%";
          colgroup.children[2].style.width = origBtn + "%";
          return;
        }
        var requiredColPx = buttonWidth + cellPadH;
        var btnPct = (requiredColPx / tableWidth) * 100;
        if (btnPct <= 50) {
          var rem = 100 - btnPct;
          var locPct = rem * (locShare / 100);
          var statusPct = rem * ((100 - locShare) / 100);
          colgroup.children[0].style.width = locPct + "%";
          colgroup.children[1].style.width = statusPct + "%";
          colgroup.children[2].style.width = btnPct + "%";
          return;
        }
        if (!savedTableHtml) savedTableHtml = table.innerHTML;
        var tb = table.querySelector("tbody");
        if (!tb) return;
        var h = "<colgroup><col style=\"width:" + locShare + "%\"><col style=\"width:" + (100 - locShare) + "%\"></colgroup><tbody>";
        var r = tb.querySelectorAll("tr");
        for (var i = 0; i < r.length; i++) {
          var t = r[i];
          var ca = (t.getAttribute("data-region-block") ? " data-region-block=\"" + (t.getAttribute("data-region-block") || "").replace(/"/g, "&quot;") + "\"" : "") + (t.getAttribute("data-location-id") ? " data-location-id=\"" + (t.getAttribute("data-location-id") || "").replace(/"/g, "&quot;") + "\"" : "");
          if (t.classList.contains("lsi-region-heading-row") || t.classList.contains("lsi-nearby-header")) {
            var td = t.querySelector("td");
            var ra = (t.getAttribute("role") ? " role=\"" + t.getAttribute("role") + "\"" : "") + (t.getAttribute("tabindex") !== null ? " tabindex=\"" + t.getAttribute("tabindex") + "\"" : "") + (t.getAttribute("aria-expanded") !== null ? " aria-expanded=\"" + t.getAttribute("aria-expanded") + "\"" : "");
            h += "<tr class=\"" + (t.className || "").replace(/"/g, "&quot;") + "\"" + ca + ra + "><td colspan=\"2\" class=\"lsi-region-heading-cell\">" + (td ? td.innerHTML : "") + "</td></tr>";
          } else if (t.classList.contains("lsi-region-data-row")) {
            var c1 = t.cells[0], c2 = t.cells[1], c3 = t.cells[2];
            var sy = t.getAttribute("style") ? " style=\"" + (t.getAttribute("style") || "").replace(/"/g, "&quot;") + "\"" : "";
            h += "<tr class=\"lsi-region-data-row\"" + ca + sy + "><td class=\"lsi-location\">" + (c1 ? c1.innerHTML : "") + "</td><td class=\"lsi-status\">" + (c2 ? c2.innerHTML : "") + "</td></tr>";
            if (c3 && c3.children && c3.children.length > 0) h += "<tr class=\"lsi-region-data-row lsi-order-pick-subrow\"" + ca + "><td colspan=\"2\" class=\"lsi-order-pick-cell lsi-order-pick-cell--full\">" + c3.innerHTML + "</td></tr>";
          } else if (t.querySelector(".lsi-nearby-body")) {
            var tx = t.querySelector("td");
            h += "<tr><td colspan=\"2\" class=\"lsi-nearby-body-cell\">" + (tx ? tx.innerHTML : "") + "</td></tr>";
          }
        }
        table.innerHTML = h + "</tbody>";
      }
      if (typeof window !== "undefined") window.addEventListener("resize", function () { adjustTableColumnWidthsForMobile(); });

      function normalizeButtonWidths() {
        var e = root.querySelectorAll(".lsi-order-pick-btn, .lsi-order-pick-out");
        if (!e || !e.length) return;
        var m = 0;
        for (var i = 0; i < e.length; i++) { var w = e[i].getBoundingClientRect().width; if (w > m) m = w; }
        if (m > 0) for (var j = 0; j < e.length; j++) e[j].style.minWidth = m + "px";
      }

      function renderStocks(stocks, opts) {
        opts = opts || {};
        bodyEl.classList.remove("lsi-message--loading", "lsi-message--error", "lsi-message--empty");

        if (!opts.skipFilterSort) {
          stocks = filterLocations(stocks);
          stocks = sortLocations(stocks);
        }

        if (!stocks || !stocks.length) {
          setMessage("empty", settings.emptyMessage);
          return;
        }

        var mainStocks = stocks;
        var otherStocks = [];
        if (opts.otherStartIndex != null && opts.otherStartIndex > 0 && stocks.length > opts.otherStartIndex) {
          mainStocks = stocks.slice(0, opts.otherStartIndex);
          otherStocks = stocks.slice(opts.otherStartIndex);
        }

        var pinnedItems = [];
        var restStocks = mainStocks;
        if (settings.groupByRegion) {
          pinnedItems = mainStocks.filter(function (item) { return item.regionKey === "__pinned__"; });
          restStocks = mainStocks.filter(function (item) { return item.regionKey !== "__pinned__"; });
        }
        var groups = settings.groupByRegion ? groupStocksByRegion(restStocks, settings.regionGroupOrder) : [{ regionKey: "", items: mainStocks }];
        if (settings.groupByRegion && pinnedItems.length) groups = [{ regionKey: "", items: pinnedItems, _pinned: true }].concat(groups);
        var html = "";
        var locWidth = 70;
        var btnColWidth = 0;
        var statusWidth = 30;
        if (settings.layoutType === "table") {
          if (settings.showOrderPickButton) {
            var locShare = Math.min(95, Math.max(5, Number(settings.locationColWidth) || 70));
            btnColWidth = Math.min(50, Math.max(15, Number(settings.orderPickColWidth) || 25));
            var remaining = 100 - btnColWidth;
            locWidth = remaining * (locShare / 100);
            statusWidth = remaining * ((100 - locShare) / 100);
          } else {
            locWidth = Math.min(85, Math.max(25, Number(settings.locationColWidth) || 70));
            statusWidth = 100 - locWidth;
          }
        }
        var colCount = settings.layoutType === "table" ? (settings.showOrderPickButton ? 3 : 2) : 0;
        var accordionEnabled = settings.groupByRegion && settings.regionAccordionEnabled;
        var regionBlockId = 0;

        function buildAccordionIconHtml() {
          var iconType = settings.accordionIcon || "chevron";
          if (iconType === "plus_minus") {
            return '<span class="lsi-region-heading-chevron lsi-region-heading-chevron--plus-minus" aria-hidden="true">' +
              '<span class="lsi-region-heading-chevron-open">−</span>' +
              '<span class="lsi-region-heading-chevron-closed">+</span>' +
              "</span>";
          }
          if (iconType === "arrow") {
            return '<span class="lsi-region-heading-chevron lsi-region-heading-chevron--arrow" aria-hidden="true">' +
              '<span class="lsi-region-heading-chevron-open">↓</span>' +
              '<span class="lsi-region-heading-chevron-closed">→</span>' +
              "</span>";
          }
          if (iconType === "angle") {
            return '<span class="lsi-region-heading-chevron lsi-region-heading-chevron--angle" aria-hidden="true">' +
              '<span class="lsi-region-heading-chevron-open">∨</span>' +
              '<span class="lsi-region-heading-chevron-closed">＞</span>' +
              "</span>";
          }
          return '<span class="lsi-region-heading-chevron lsi-region-heading-chevron--chevron" aria-hidden="true"></span>';
        }

        function buildRegionHeadingStyle() {
          var appRs = settings.regionStyle || {};
          var themeRs = settings.themeRegionHeadingStyle || {};
          var rs = {};
          [appRs, themeRs].forEach(function (source) {
            if (!source || typeof source !== "object") return;
            Object.keys(source).forEach(function (k) {
              var v = source[k];
              if (v != null && String(v).trim() !== "") rs[k] = v;
            });
          });
          if (Object.keys(rs).length === 0) return "";
          var parts = [];
          if (rs.backgroundColor) parts.push("background:" + String(rs.backgroundColor).replace(/"/g, "&quot;"));
          if (rs.color) parts.push("color:" + String(rs.color).replace(/"/g, "&quot;"));
          if (rs.fontSize != null) {
            var fs = rs.fontSize;
            parts.push("font-size:" + (typeof fs === "number" ? fs + "px" : String(fs).replace(/"/g, "&quot;")));
          }
          if (rs.fontWeight) parts.push("font-weight:" + String(rs.fontWeight).replace(/"/g, "&quot;"));
          if (rs.padding != null) {
            var pd = rs.padding;
            parts.push("padding:" + (typeof pd === "number" ? pd + "px" : String(pd).replace(/"/g, "&quot;")));
          }
          else {
            if (rs.paddingTop) parts.push("padding-top:" + String(rs.paddingTop).replace(/"/g, "&quot;"));
            if (rs.paddingBottom) parts.push("padding-bottom:" + String(rs.paddingBottom).replace(/"/g, "&quot;"));
            if (rs.paddingLeft) parts.push("padding-left:" + String(rs.paddingLeft).replace(/"/g, "&quot;"));
            if (rs.paddingRight) parts.push("padding-right:" + String(rs.paddingRight).replace(/"/g, "&quot;"));
          }
          return parts.length ? parts.join(";") : "";
        }
        function addTableRow(item, isHeading, headingLabel, blockId, initiallyHidden) {
          var tr = "<tr";
          if (isHeading) {
            var regionStyleStr = buildRegionHeadingStyle();
            tr += ' class="lsi-region-heading-row" data-region-block="' + blockId + '"';
            if (accordionEnabled) tr += ' role="button" tabindex="0" aria-expanded="' + (initiallyHidden ? "false" : "true") + '"';
            tr += ">";
            var alignCls = "lsi-region-heading-cell-inner--" + (settings.regionHeadingAlign || "left");
            tr += '<td colspan="' + colCount + '" class="lsi-region-heading-cell"' + (regionStyleStr ? ' style="' + regionStyleStr + '"' : '') + '>';
            tr += '<div class="lsi-region-heading-cell-inner ' + alignCls + '">';
            tr += '<span class="lsi-region-heading-label">' + (headingLabel || "") + "</span>";
            if (accordionEnabled) tr += buildAccordionIconHtml();
            tr += "</div></td></tr>";
            return tr;
          }
          if (accordionEnabled && initiallyHidden) tr += ' style="display:none;"';
          tr += ' data-region-block="' + blockId + '" data-location-id="' + (item.locationId || "") + '" class="lsi-region-data-row">';
          var status = getStatusSymbolAndLabel(item.quantity || 0);
          var name = item.displayName || item.locationName || "";
          var nameHtml = applyClickAction(item, name);
          tr += '<td class="lsi-location" style="width:' + locWidth + '%;">' + nameHtml + "</td>";
          tr += '<td class="lsi-status" style="width:' + statusWidth + '%;">' + buildStatusHtml(item, status) + "</td>";
          if (settings.showOrderPickButton) tr += '<td class="lsi-order-pick-cell lsi-order-pick-cell--' + (settings.orderPickBtnAlign || "right") + '" style="width:' + btnColWidth + '%;">' + buildOrderPickButton(item) + "</td>";
          tr += "</tr>";
          return tr;
        }
        function addListItem(item, isHeading, headingLabel, blockId, initiallyHidden) {
          if (isHeading) {
            var regionStyleStr = buildRegionHeadingStyle();
            var itemAlignCls = "lsi-region-heading-item--" + (settings.regionHeadingAlign || "left");
            var li = '<li class="lsi-region-heading-item lsi-item ' + itemAlignCls + '" data-region-block="' + blockId + '"' + (regionStyleStr ? ' style="' + regionStyleStr + '"' : '') + '';
            if (accordionEnabled) li += ' role="button" tabindex="0" aria-expanded="' + (initiallyHidden ? "false" : "true") + '"';
            li += ">";
            li += '<span class="lsi-region-heading-label">' + (headingLabel || "") + "</span>";
            if (accordionEnabled) li += buildAccordionIconHtml();
            li += "</li>";
            return li;
          }
          var li = '<li class="lsi-item lsi-region-data-item" data-region-block="' + blockId + '" data-location-id="' + (item.locationId || "") + '"';
          if (accordionEnabled && initiallyHidden) li += ' style="display:none;"';
          li += ">";
          var status = getStatusSymbolAndLabel(item.quantity || 0);
          var name = item.displayName || item.locationName || "";
          var nameHtml = applyClickAction(item, name);
          var rowHtml = "";
          if (settings.layoutType === "stacked") {
            rowHtml = '<div class="lsi-stacked-name">' + nameHtml + "</div>" + '<div class="lsi-stacked-status">' + buildStatusHtml(item, status) + "</div>";
            if (settings.showOrderPickButton) rowHtml += '<div class="lsi-order-pick-wrap lsi-order-pick-wrap--' + (settings.orderPickBtnAlign || "right") + '">' + buildOrderPickButton(item) + "</div>";
          } else {
            var sep = settings.listSeparator || "： ";
            rowHtml = '<span class="lsi-location">' + nameHtml + "</span>" + sep + '<span class="lsi-status">' + buildStatusHtml(item, status) + "</span>";
            if (settings.showOrderPickButton) rowHtml += '<span class="lsi-order-pick-wrap lsi-order-pick-wrap--' + (settings.orderPickBtnAlign || "right") + '">' + buildOrderPickButton(item) + "</span>";
          }
          li += rowHtml + "</li>";
          return li;
        }

        var nearbyBodyId = "";
        var nearbyInitMsg = "位置情報をONに設定した後、ご利用いただけます。";
        if (settings.nearbyFirstEnabled && opts.hasCoordsForNearby) {
          nearbyBodyId = root.id + "-nearby-body";
        }
        if (settings.layoutType === "table") {
          html += '<div class="lsi-table-wrap">';
          html += '<table class="lsi-table">';
          html += '<colgroup><col style="width:' + locWidth + '%"><col style="width:' + statusWidth + '%">' + (settings.showOrderPickButton ? '<col style="width:' + btnColWidth + '%">' : '') + '</colgroup>';
          html += '<tbody>';
          if (settings.nearbyFirstEnabled && opts.hasCoordsForNearby) {
            var nearbyStyleStr = buildRegionHeadingStyle();
            var innerAlignCls = "lsi-region-heading-cell-inner--" + (settings.regionHeadingAlign || "left");
            html += '<tr class="lsi-region-heading-row lsi-nearby-header" data-region-block="nearby" role="button" tabindex="0" aria-expanded="false">';
            html += '<td colspan="' + colCount + '" class="lsi-region-heading-cell"' + (nearbyStyleStr ? ' style="' + nearbyStyleStr + '"' : '') + '>';
            html += '<div class="lsi-region-heading-cell-inner ' + innerAlignCls + '">';
            var nearbyLabel = (settings.nearbyHeading && settings.nearbyHeading.trim()) ? settings.nearbyHeading.trim() : "近隣店舗";
            html += '<span class="lsi-region-heading-label">' + nearbyLabel + '</span>';
            html += buildAccordionIconHtml();
            html += '</div></td></tr>';
            html += '<tr class="lsi-region-data-row" data-region-block="nearby" style="display:none;">';
            html += '<td colspan="' + colCount + '" class="lsi-nearby-body-cell"><div id="' + nearbyBodyId + '" class="lsi-nearby-body">' + nearbyInitMsg + '</div></td></tr>';
          }
          var otherHeadingText = (settings.nearbyOtherHeading && settings.nearbyOtherHeading.trim()) ? settings.nearbyOtherHeading.trim() : "";
          if (settings.nearbyFirstEnabled && opts.hasCoordsForNearby && otherHeadingText) {
            var totalInGroups = groups.reduce(function (sum, g) { return sum + (g.items ? g.items.length : 0); }, 0);
            if (totalInGroups > 0) {
              var otherBlockIdForHeading = regionBlockId++;
              html += addTableRow(null, true, otherHeadingText, otherBlockIdForHeading, true);
            }
          }
          groups.forEach(function (group) {
            var blockId = regionBlockId++;
            var items = group.items;
            var regionLabel = group._pinned ? null : (group.regionKey ? (group.regionKey === "未設定" ? (settings.regionUnsetLabel || "その他") : group.regionKey) : null);
            var initiallyOpen = !accordionEnabled || blockId === 0;
            if (settings.groupByRegion && regionLabel) {
              html += addTableRow(null, true, regionLabel, blockId, !initiallyOpen);
            }
            items.forEach(function (item) {
              html += addTableRow(item, false, null, blockId, !initiallyOpen);
            });
          });
          if (otherStocks.length > 0) {
            var otherBlockId = regionBlockId++;
            var otherHeadingForRest = (settings.nearbyOtherHeading && settings.nearbyOtherHeading.trim()) ? settings.nearbyOtherHeading.trim() : "";
            if (otherHeadingForRest) {
              html += addTableRow(null, true, otherHeadingForRest, otherBlockId, true);
            }
            otherStocks.forEach(function (item) {
              html += addTableRow(item, false, null, otherBlockId, true);
            });
          }
          html += "</tbody></table></div>";
        } else {
          html += '<ul class="lsi-list">';
          if (settings.nearbyFirstEnabled && opts.hasCoordsForNearby) {
            var nearbyStyleStrList = buildRegionHeadingStyle();
            var nearbyLabelList = (settings.nearbyHeading && settings.nearbyHeading.trim()) ? settings.nearbyHeading.trim() : "近隣店舗";
            var nearbyItemAlignCls = "lsi-region-heading-item--" + (settings.regionHeadingAlign || "left");
            html += '<li class="lsi-region-heading-item lsi-item lsi-nearby-header ' + nearbyItemAlignCls + '" data-region-block="nearby" role="button" tabindex="0" aria-expanded="false"' + (nearbyStyleStrList ? ' style="' + nearbyStyleStrList + '"' : '') + '>';
            html += '<span class="lsi-region-heading-label">' + nearbyLabelList + '</span>';
            html += buildAccordionIconHtml();
            html += '</li>';
            html += '<li class="lsi-item lsi-region-data-item lsi-nearby-body-item" data-region-block="nearby" style="display:none;">';
            html += '<div id="' + nearbyBodyId + '" class="lsi-nearby-body">' + nearbyInitMsg + '</div>';
            html += '</li>';
          }
          var otherHeadingTextList = (settings.nearbyOtherHeading && settings.nearbyOtherHeading.trim()) ? settings.nearbyOtherHeading.trim() : "";
          if (settings.nearbyFirstEnabled && opts.hasCoordsForNearby && otherHeadingTextList) {
            var totalInGroupsList = groups.reduce(function (sum, g) { return sum + (g.items ? g.items.length : 0); }, 0);
            if (totalInGroupsList > 0) {
              var otherBlockIdForHeadingList = regionBlockId++;
              html += addListItem(null, true, otherHeadingTextList, otherBlockIdForHeadingList, true);
            }
          }
          groups.forEach(function (group) {
            var blockId = regionBlockId++;
            var items = group.items;
            var regionLabel = group._pinned ? null : (group.regionKey ? (group.regionKey === "未設定" ? (settings.regionUnsetLabel || "その他") : group.regionKey) : null);
            var initiallyOpen = !accordionEnabled || blockId === 0;
            if (settings.groupByRegion && regionLabel) {
              html += addListItem(null, true, regionLabel, blockId, !initiallyOpen);
            }
            items.forEach(function (item) {
              html += addListItem(item, false, null, blockId, !initiallyOpen);
            });
          });
          if (otherStocks.length > 0) {
            var otherBlockId = regionBlockId++;
            var otherHeadingForRestList = (settings.nearbyOtherHeading && settings.nearbyOtherHeading.trim()) ? settings.nearbyOtherHeading.trim() : "";
            if (otherHeadingForRestList) {
              html += addListItem(null, true, otherHeadingForRestList, otherBlockId, true);
            }
            otherStocks.forEach(function (item) {
              html += addListItem(item, false, null, otherBlockId, true);
            });
          }
          html += "</ul>";
        }

        bodyEl.innerHTML = html;

        if (settings.layoutType === "table") {
          var wrap = root.querySelector(".lsi-table-wrap");
          if (wrap) {
            var py = root.getAttribute("data-table-row-padding-y");
            var px = root.getAttribute("data-table-row-padding-x");
            var bw = root.getAttribute("data-table-border-width");
            var bc = root.getAttribute("data-table-border-color");
            var bStyle = root.getAttribute("data-table-border-style") || "rows";
            var hasBorder = bStyle === "rows" || bStyle === "full";
            var pad = (py !== null && px !== null) ? py + "px " + px + "px" : "8px 12px";
            var borderBottom = (hasBorder && bw !== null && bc !== null) ? bw + "px solid " + bc : "none";
            var tbl = wrap.querySelector(".lsi-table");
            if (tbl) {
              if (bStyle === "full" && bw !== null && bc !== null) {
                tbl.style.border = bw + "px solid " + bc;
                tbl.style.borderRadius = "4px";
              }
              [].forEach.call(wrap.querySelectorAll("td"), function (td) {
                td.style.padding = pad;
                td.style.borderBottom = borderBottom;
                td.style.verticalAlign = "middle";
              });
              if (bStyle === "full" && bw !== null && bc !== null) {
                [].forEach.call(wrap.querySelectorAll("td + td"), function (td) {
                  td.style.borderLeft = bw + "px solid " + bc;
                });
              }
            }
          }
        }
        if (settings.layoutType === "table" && settings.showOrderPickButton) {
          setTimeout(function () { adjustTableColumnWidthsForMobile(); }, 0);
        }
        if (settings.showOrderPickButton) {
          setTimeout(function () { normalizeButtonWidths(); }, 0);
        }

        root.querySelectorAll(".lsi-region-heading-row[role=\"button\"][data-region-block]:not(.lsi-nearby-header), .lsi-region-heading-item[role=\"button\"][data-region-block]:not(.lsi-nearby-header)").forEach(function (headingEl) {
          headingEl.addEventListener("click", function () {
            var expanded = this.getAttribute("aria-expanded") === "true";
            var blockId = this.getAttribute("data-region-block");
            var container = this.closest("table") || this.closest("ul");
            if (container) {
              var dataRows = container.querySelectorAll(".lsi-region-data-row[data-region-block=\"" + blockId + "\"], .lsi-region-data-item[data-region-block=\"" + blockId + "\"]");
              var show = !expanded;
              var displayVal = headingEl.classList.contains("lsi-region-heading-row") ? "table-row" : "block";
              dataRows.forEach(function (el) {
                el.style.display = show ? displayVal : "none";
              });
            }
            this.setAttribute("aria-expanded", !expanded);
          });
          headingEl.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              this.click();
            }
          });
        });

        if (settings.nearbyFirstEnabled && opts.hasCoordsForNearby) {
          bindNearbyAccordion(stocks, bodyEl);
        }
      }

      function bindNearbyAccordion(stocks, containerEl) {
        var nearbyStocks = (stocks || []).filter(function (s) { return !s.excludeFromNearby; });
        var doc = root.ownerDocument || document;
        var btn = root.querySelector(".lsi-nearby-header");
        var body = doc.getElementById(root.id + "-nearby-body") || root.querySelector(".lsi-nearby-body");
        if (!btn || !body) return;
        var loaded = false;
        var locWidth = 70;
        var btnColWidth = 0;
        var statusWidth = 30;
        if (settings.showOrderPickButton) {
          var locShare = Math.min(95, Math.max(5, Number(settings.locationColWidth) || 70));
          btnColWidth = Math.min(50, Math.max(15, Number(settings.orderPickColWidth) || 25));
          var remaining = 100 - btnColWidth;
          locWidth = remaining * (locShare / 100);
          statusWidth = remaining * ((100 - locShare) / 100);
        } else {
          locWidth = Math.min(85, Math.max(25, Number(settings.locationColWidth) || 70));
          statusWidth = 100 - locWidth;
        }
        var bodyRow = body.closest("tr") || body.closest("li");

        function applyTableCellStyles(cells) {
          if (!cells || !cells.length) return;
          var py = root.getAttribute("data-table-row-padding-y");
          var px = root.getAttribute("data-table-row-padding-x");
          var bw = root.getAttribute("data-table-border-width");
          var bc = root.getAttribute("data-table-border-color");
          var bStyle = root.getAttribute("data-table-border-style") || "rows";
          var hasBorder = bStyle === "rows" || bStyle === "full";
          var pad = (py !== null && px !== null) ? py + "px " + px + "px" : "8px 12px";
          var borderBottom = (hasBorder && bw !== null && bc !== null) ? bw + "px solid " + bc : "none";
          [].forEach.call(cells, function (td) {
            td.style.padding = pad;
            td.style.borderBottom = borderBottom;
            td.style.verticalAlign = "middle";
          });
          if (bStyle === "full" && bw !== null && bc !== null) {
            for (var i = 1; i < cells.length; i++) {
              cells[i].style.borderLeft = bw + "px solid " + bc;
            }
          }
        }
        function fillBodyWithNearest(nearest) {
          var status = getStatusSymbolAndLabel(nearest.quantity || 0);
          var name = nearest.displayName || nearest.locationName || "";
          var nameHtml = applyClickAction(nearest, name);
          if (settings.layoutType === "table" && bodyRow && bodyRow.tagName === "TR") {
            var trHtml = '<td class="lsi-location" style="width:' + locWidth + '%;">' + nameHtml + '</td>';
            trHtml += '<td class="lsi-status" style="width:' + statusWidth + '%;">' + buildStatusHtml(nearest, status) + '</td>';
            if (settings.showOrderPickButton) trHtml += '<td class="lsi-order-pick-cell lsi-order-pick-cell--' + (settings.orderPickBtnAlign || "right") + '" style="width:' + btnColWidth + '%;">' + buildOrderPickButton(nearest) + '</td>';
            bodyRow.innerHTML = trHtml;
            applyTableCellStyles(bodyRow.querySelectorAll("td"));
            setTimeout(function () { if (typeof normalizeButtonWidths === "function") normalizeButtonWidths(); }, 0);
            return;
          }
          var rowHtml;
          if (settings.layoutType === "stacked") {
            rowHtml = '<div class="lsi-stacked-name">' + nameHtml + "</div>" + '<div class="lsi-stacked-status">' + buildStatusHtml(nearest, status) + "</div>";
            if (settings.showOrderPickButton) rowHtml += '<div class="lsi-order-pick-wrap lsi-order-pick-wrap--' + (settings.orderPickBtnAlign || "right") + '">' + buildOrderPickButton(nearest) + "</div>";
          } else {
            var sep = settings.listSeparator || "： ";
            rowHtml = '<span class="lsi-location">' + nameHtml + "</span>" + sep + '<span class="lsi-status">' + buildStatusHtml(nearest, status) + "</span>";
            if (settings.showOrderPickButton) rowHtml += '<span class="lsi-order-pick-wrap lsi-order-pick-wrap--' + (settings.orderPickBtnAlign || "right") + '">' + buildOrderPickButton(nearest) + "</span>";
          }
          body.innerHTML = rowHtml;
          if (settings.showOrderPickButton) setTimeout(function () { if (typeof normalizeButtonWidths === "function") normalizeButtonWidths(); }, 0);
        }
        function showBodyError(msg) {
          body.innerHTML = "<span>" + msg + "</span>";
        }

        function toggleNearbyBody() {
          var expanded = btn.getAttribute("aria-expanded") === "true";
          var show = !expanded;
          if (bodyRow) {
            bodyRow.style.display = show ? (btn.classList.contains("lsi-region-heading-row") ? "table-row" : "block") : "none";
          }
          btn.setAttribute("aria-expanded", show ? "true" : "false");
        }
        function onNearbyBtnClick(e) {
          if (e && e.preventDefault) e.preventDefault();
          if (!loaded) {
            loaded = true;
            toggleNearbyBody();
            body.innerHTML = "<span>位置情報を取得中...</span>";
            if (typeof navigator === "undefined" || !navigator.geolocation) {
              showBodyError("位置情報を利用できません。条件に該当する店舗が見つかりませんでした。");
              return;
            }
            navigator.geolocation.getCurrentPosition(
              function (pos) {
                var byDistance = sortByDistance(nearbyStocks, pos.coords.latitude, pos.coords.longitude);
                var nearest = byDistance[0];
                if (!nearest) {
                  showBodyError("条件に該当する店舗が見つかりませんでした。");
                  return;
                }
                fillBodyWithNearest(nearest);
                sendAnalyticsEvent("nearby_click", { locationIds: nearest.locationId ? [nearest.locationId] : [] });
              },
              function () {
                showBodyError("位置情報を利用できません。条件に該当する店舗が見つかりませんでした。");
              },
              { timeout: 5000, maximumAge: 60000, enableHighAccuracy: true }
            );
            return;
          }
          toggleNearbyBody();
        }
        btn.addEventListener("click", onNearbyBtnClick);
        btn.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onNearbyBtnClick(e);
          }
        });
      }

      var lastVariantId = null;
      var fetchRetryFor = null;
      // 再試行しても解消しない API code（3s リトライをスキップ）
      // session_reauth_* は Phase0 の 1 回リトライ対象のまま
      var NO_RETRY_CODES = {
        plan_required: true,
        plan_lookup_failed: true,
        missing_variant_id: true,
        missing_admin_client: true
      };
      function onFetchFailure(vid, code, apiMessage) {
        lastVariantId = null;
        if (code) console.error("[location-stock] API error", code);
        var display =
          typeof apiMessage === "string" && apiMessage.trim() !== ""
            ? apiMessage.trim()
            : settings.errorMessage;
        setMessage("error", display);
        if (vid && fetchRetryFor !== vid && !NO_RETRY_CODES[code]) {
          fetchRetryFor = vid;
          setTimeout(function () { fetchStocks(vid); }, 3000);
        }
      }

      function fetchStocks(variantId) {
        setMessage("loading", settings.loadingMessage);
        fetch("/apps/location-stock?variant_id=" + encodeURIComponent(variantId))
          .then(function (res) {
            if (!res.ok) throw new Error("HTTP " + res.status);
            return res.json();
          })
          .then(function (data) {
            try {
            if (!data || data.ok === false) {
              onFetchFailure(
                variantId,
                data && data.error,
                data && data.message
              );
              return;
            }
            fetchRetryFor = null;

            var appConfig = data.config || {};

            if (appConfig.thresholds) {
              if (typeof appConfig.thresholds.outOfStockMax === "number") {
                settings.outOfStockMax = appConfig.thresholds.outOfStockMax;
              }
              if (typeof appConfig.thresholds.inStockMin === "number") {
                settings.inStockMin = appConfig.thresholds.inStockMin;
              }
            }

            if (appConfig.quantity) {
              var q = appConfig.quantity;
              if (typeof q.quantityLabel === "string") {
                settings.quantityLabel = q.quantityLabel;
              }
              if (typeof q.wrapperBefore === "string") {
                settings.quantityWrapperBefore = q.wrapperBefore;
              }
              if (typeof q.wrapperAfter === "string") {
                settings.quantityWrapperAfter = q.wrapperAfter;
              }
            }

            if (appConfig.symbols) {
              var sy = appConfig.symbols;
              if (typeof sy.inStock === "string") {
                settings.symbolInStock = sy.inStock;
              }
              if (typeof sy.lowStock === "string") {
                settings.symbolLowStock = sy.lowStock;
              }
              if (typeof sy.outOfStock === "string") {
                settings.symbolOutOfStock = sy.outOfStock;
              }
            }

            if (appConfig.labels) {
              var lb = appConfig.labels;
              if (typeof lb.inStock === "string") {
                settings.labelInStock = lb.inStock;
              }
              if (typeof lb.lowStock === "string") {
                settings.labelLowStock = lb.lowStock;
              }
              if (typeof lb.outOfStock === "string") {
                settings.labelOutOfStock = lb.outOfStock;
              }
            }

            if (appConfig.messages) {
              var m = appConfig.messages;
              if (typeof m.loading === "string") {
                settings.loadingMessage = m.loading;
              }
              if (typeof m.empty === "string") {
                settings.emptyMessage = m.empty;
              }
              if (typeof m.error === "string") {
                settings.errorMessage = m.error;
              }
            }

            if (
              appConfig.notice &&
              typeof appConfig.notice.text === "string" &&
              appConfig.notice.text !== ""
            ) {
              settings.noticeText = appConfig.notice.text;
            }

            if (appConfig.sort && typeof appConfig.sort.mode === "string") {
              settings.sortBy = appConfig.sort.mode;
            }
            if (typeof appConfig.pinnedLocationId === "string" && appConfig.pinnedLocationId.trim() !== "") {
              settings.pinnedLocationId = appConfig.pinnedLocationId.trim();
            } else {
              settings.pinnedLocationId = null;
            }

            if (appConfig.locations) {
              var locConf = appConfig.locations;
              if (typeof locConf.mode === "string") {
                settings.locationsMode = locConf.mode;
              }
              if (typeof locConf.usePublicName === "boolean") {
                settings.usePublicLocationName = locConf.usePublicName;
              }
            }

            if (appConfig.click) {
              var click = appConfig.click;
              if (typeof click.action === "string") {
                settings.clickAction = click.action;
              }
              if (typeof click.mapUrlTemplate === "string") {
                settings.mapUrlTemplate = click.mapUrlTemplate;
              }
              if (typeof click.urlTemplate === "string") {
                settings.urlTemplate = click.urlTemplate;
              }
            }
            if (appConfig.future && typeof appConfig.future.showLocationLinks === "boolean") {
              settings.showLocationLinks = appConfig.future.showLocationLinks;
            }

            if (appConfig.display) {
              if (typeof appConfig.display.showLegend === "boolean") settings.showLegend = appConfig.display.showLegend;
              if (typeof appConfig.display.showNotice === "boolean") settings.showNotice = appConfig.display.showNotice;
              if (typeof appConfig.display.listSeparator === "string") settings.listSeparator = appConfig.display.listSeparator;
            }
            if (appConfig.quantity && typeof appConfig.quantity.rowContentMode === "string") {
              settings.rowContentMode = appConfig.quantity.rowContentMode;
            }

            if (appConfig.regionGroups && Array.isArray(appConfig.regionGroups)) {
              settings.regionGroupOrder = appConfig.regionGroups.map(function (g) { return g.name; });
            }
            if (appConfig.future) {
              var f = appConfig.future;
              if (typeof f.groupByRegion === "boolean") {
                settings.groupByRegion = f.groupByRegion;
              }
              if (typeof f.regionAccordionEnabled === "boolean") {
                settings.regionAccordionEnabled = f.regionAccordionEnabled;
              }
              if (typeof f.nearbyFirstEnabled === "boolean") {
                settings.nearbyFirstEnabled = f.nearbyFirstEnabled;
              }
              if (typeof f.nearbyOtherCollapsible === "boolean") {
                settings.nearbyOtherCollapsible = f.nearbyOtherCollapsible;
              }
              if (typeof f.nearbyHeading === "string") {
                settings.nearbyHeading = f.nearbyHeading.trim();
              }
              if (typeof f.showOrderPickButton === "boolean") {
                settings.showOrderPickButton = f.showOrderPickButton;
              }
              if (typeof f.orderPickButtonLabel === "string") {
                settings.orderPickButtonLabel = f.orderPickButtonLabel;
              }
              if (typeof f.orderPickAddingLabel === "string") {
                settings.orderPickAddingLabel = f.orderPickAddingLabel.trim();
              }
              if (typeof f.orderPickAddedLabel === "string") {
                settings.orderPickAddedLabel = f.orderPickAddedLabel.trim() || "追加しました";
              }
              if (typeof f.orderPickOutOfStockLabel === "string") {
                settings.orderPickOutOfStockLabel = f.orderPickOutOfStockLabel.trim() || "Sold Out";
              }
              if (typeof f.orderPickModalTitle === "string") {
                settings.orderPickModalTitle = f.orderPickModalTitle.trim() || "カートに追加しました（{count}点）";
              }
              if (typeof f.orderPickModalBody === "string") {
                settings.orderPickModalBody = f.orderPickModalBody.trim();
              }
              if (typeof f.regionUnsetLabel === "string") {
                settings.regionUnsetLabel = f.regionUnsetLabel.trim() || "その他";
              }
              if (typeof f.nearbyOtherHeading === "string") {
                settings.nearbyOtherHeading = f.nearbyOtherHeading.trim();
              }
              if (typeof f.orderPickRedirectToCheckout === "boolean") {
                settings.orderPickRedirectToCheckout = f.orderPickRedirectToCheckout;
              }
            }

            updateLegendElements();
            updateNoticeElements();
            applyLegendNoticeVisibility();

            var stocks = null;

            if (Array.isArray(data.stocks)) {
              stocks = data.stocks;
            } else if (Array.isArray(data.locations)) {
              stocks = data.locations.map(function (loc) {
                var quantity =
                  typeof loc.quantity === "number"
                    ? loc.quantity
                    : typeof loc.available === "number"
                    ? loc.available
                    : 0;

                return {
                  locationId: loc.locationId || loc.id || null,
                  locationName: loc.locationName || loc.name || "Unknown location",
                  fulfillsOnlineOrders:
                    !!loc.fulfillOnline ||
                    !!loc.fulfillOnlineOrders ||
                    !!loc.fulfillsOnlineOrders,
                  quantity: quantity
                };
              });
            }

            if (!Array.isArray(stocks) || !stocks.length) {
              setMessage("empty", settings.emptyMessage);
              return;
            }

            stocks = filterLocations(stocks);
            stocks = sortLocations(stocks);
            var hasCoords = stocks.some(function (s) { return s.latitude != null && s.longitude != null; });
            renderStocks(stocks, { skipFilterSort: true, hasCoordsForNearby: hasCoords });
              sendAnalyticsEvent("area_display", {});
            } catch (e) {
              console.error("[location-stock] render error", e);
              onFetchFailure(variantId, "render");
            }
          })
          .catch(function (err) {
            console.error("[location-stock] fetch error", err);
            onFetchFailure(variantId, "network");
          });
      }

      updateLegendElements();
      updateNoticeElements();
      applyLegendNoticeVisibility();

      function updateStocksByVariantId(variantId) {
        if (!variantId) return;
        if (variantId === lastVariantId) return;
        lastVariantId = variantId;
        root.dataset.variantId = variantId;
        fetchStocks(variantId);
      }

      var initialVariantId = root.dataset.variantId;
      if (initialVariantId) {
        updateStocksByVariantId(initialVariantId);
      }

      document.addEventListener("variant:change", function (event) {
        var variant = event.detail && event.detail.variant;
        if (!variant || !variant.id) return;
        updateStocksByVariantId(variant.id);
      });

      var variantIdInput = document.querySelector('form[action^="/cart/add"] [name="id"]');
      if (variantIdInput) {
        variantIdInput.addEventListener("change", function () {
          updateStocksByVariantId(this.value);
        });
      }
  }
  function run() {
    document.querySelectorAll('script[type="application/json"][data-lsi-boot]').forEach(start);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
