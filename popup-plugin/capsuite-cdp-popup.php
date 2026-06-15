<?php
/**
 * Plugin Name: Capsuite CDP Popup
 * Description: Connects your WordPress site to Capsuite CDP - tracks visitor sessions and displays personalised interactive popups.
 * Version: 2.0.0
 * Author: Capsuite
 */

if (!defined('ABSPATH')) exit;

// ─────────────────────────────────────────────────────────────────────────────
// 1. ADMIN SETTINGS
// ─────────────────────────────────────────────────────────────────────────────

add_action('admin_menu', 'capsuite_menu');
function capsuite_menu() {
    add_menu_page(
        'Capsuite CDP',
        'Capsuite CDP',
        'manage_options',
        'capsuite-cdp',
        'capsuite_settings_page',
        'dashicons-admin-network',
        100
    );
}

add_action('admin_init', 'capsuite_register_settings');
function capsuite_register_settings() {
    register_setting('capsuite_group', 'capsuite_company_id');
    register_setting('capsuite_group', 'capsuite_display_urls');
    register_setting('capsuite_group', 'capsuite_popup_position');
    register_setting('capsuite_group', 'capsuite_popup_width',  ['sanitize_callback' => 'absint']);
    register_setting('capsuite_group', 'capsuite_popup_height', ['sanitize_callback' => 'absint']);
}

function capsuite_settings_page() {
    if (!current_user_can('manage_options')) return;
    ?>
    <div class="wrap">
        <h1>Capsuite CDP Settings</h1>

        <?php
        // ── Connection test result ──────────────────────────────────────────
        if (isset($_GET['capsuite_test'])) {
            $company_id = get_option('capsuite_company_id', '');
            if (empty(trim($company_id))) {
                echo '<div class="notice notice-error"><p><strong>Test failed:</strong> No Company ID configured.</p></div>';
            } else {
                $api_url = 'https://interaction-services.capsuite.co/interaction/retrieve?company_id=' . urlencode($company_id) . '&capsuite_sid=test&capsuite_apid=test';
                $response = wp_remote_get($api_url, ['timeout' => 5]);
                if (is_wp_error($response)) {
                    echo '<div class="notice notice-error"><p><strong>Test failed:</strong> Could not reach the Capsuite service. Check your server's internet connection.</p></div>';
                } else {
                    $code = wp_remote_retrieve_response_code($response);
                    if ($code === 200 || $code === 400) {
                        // 400 = service reachable but company_id invalid - still means connection works
                        $body = json_decode(wp_remote_retrieve_body($response), true);
                        if ($code === 200 || isset($body['message'])) {
                            echo '<div class="notice notice-success"><p><strong>Connection successful!</strong> The Capsuite service is reachable and your Company ID is valid.</p></div>';
                        } else {
                            echo '<div class="notice notice-warning"><p><strong>Partial success:</strong> Service reachable but Company ID may be invalid. Verify your Company ID in the CDP dashboard.</p></div>';
                        }
                    } else {
                        echo '<div class="notice notice-error"><p><strong>Test failed:</strong> Unexpected response (HTTP ' . intval($code) . '). Check your Company ID.</p></div>';
                    }
                }
            }
        }
        ?>

        <form method="post" action="options.php">
            <?php settings_fields('capsuite_group'); ?>
            <table class="form-table">
                <tr>
                    <th>Company ID <span style="color:red">*</span></th>
                    <td>
                        <input type="text" name="capsuite_company_id"
                               value="<?php echo esc_attr(get_option('capsuite_company_id', '')); ?>"
                               style="width:420px" />
                        <p class="description">Copy your Company ID from the CDP dashboard → Integrations → WordPress Plugin.</p>
                    </td>
                </tr>
                <tr>
                    <th>Display on URLs</th>
                    <td>
                        <textarea name="capsuite_display_urls" rows="5" style="width:420px"><?php
                            echo esc_textarea(get_option('capsuite_display_urls', ''));
                        ?></textarea>
                        <p class="description">
                            One pattern per line. Use <code>*</code> to match all pages, <code>/product/*</code> for a section, or <code>/specific-page</code> for an exact match.
                        </p>
                    </td>
                </tr>
                <tr>
                    <th>Popup Position</th>
                    <td>
                        <select name="capsuite_popup_position">
                            <?php
                            $pos = get_option('capsuite_popup_position', 'center');
                            $options = [
                                'center'       => 'Center Screen',
                                'bottom-right' => 'Bottom Right',
                                'bottom-left'  => 'Bottom Left',
                                'top-right'    => 'Top Right',
                                'top-left'     => 'Top Left',
                            ];
                            foreach ($options as $val => $label) {
                                printf('<option value="%s"%s>%s</option>', esc_attr($val), selected($pos, $val, false), esc_html($label));
                            }
                            ?>
                        </select>
                        <p class="description">Default position for popups on this site. You can preview how each type looks from the CDP dashboard.</p>
                    </td>
                </tr>
                <tr>
                    <th>Max Width</th>
                    <td>
                        <input type="number" name="capsuite_popup_width"
                               value="<?php echo esc_attr(get_option('capsuite_popup_width', 600)); ?>"
                               style="width:100px" /> px
                        <p class="description">Maximum width of the popup container (default: 600).</p>
                    </td>
                </tr>
                <tr>
                    <th>Max Height</th>
                    <td>
                        <input type="number" name="capsuite_popup_height"
                               value="<?php echo esc_attr(get_option('capsuite_popup_height', 500)); ?>"
                               style="width:100px" /> px
                        <p class="description">Maximum height of the popup container (default: 500).</p>
                    </td>
                </tr>
            </table>
            <?php submit_button(); ?>
        </form>

        <hr />
        <h2>Test Connection</h2>
        <p>After saving your Company ID, click below to verify the plugin can reach the Capsuite service.</p>
        <a href="<?php echo esc_url(admin_url('admin.php?page=capsuite-cdp&capsuite_test=1')); ?>"
           class="button button-secondary">Test Connection</a>
    </div>
    <?php
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. COOKIE / SESSION MANAGEMENT  (injected in <head>)
// ─────────────────────────────────────────────────────────────────────────────

add_action('wp_head', 'capsuite_tracking_script');
function capsuite_tracking_script() {
    ?>
    <script>
    (function() {
        // ── Persistent visitor ID (_ap_id) ────────────────────────────────
        // Survives across sessions; identifies the same browser across visits.
        function getCookie(name) {
            var match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
            return match ? decodeURIComponent(match[1]) : null;
        }
        function setCookie(name, value, days) {
            var expires = new Date(Date.now() + days * 864e5).toUTCString();
            document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax';
        }
        function randomId() {
            return Math.random().toString(36).substring(2, 14) + Math.random().toString(36).substring(2, 6);
        }

        // capsuite_apid - persistent (10 years), identifies the browser
        if (!getCookie('_ap_id')) {
            setCookie('_ap_id', randomId(), 3650);
        }

        // capsuite_sid - session-scoped (expires when browser closes via sessionStorage)
        // Using sessionStorage so it resets per tab/session, unlike a long-lived cookie
        if (!sessionStorage.getItem('_capsuite_sid')) {
            sessionStorage.setItem('_capsuite_sid', randomId());
        }

        window.capsuiteGetApid = function() { return getCookie('_ap_id') || ''; };
        window.capsuiteGetSid  = function() { return sessionStorage.getItem('_capsuite_sid') || ''; };

        // ── GA custom dimensions (if GA is present) ───────────────────────
        if (typeof gtag === 'function') {
            gtag('set', 'user_properties', {
                capsuite_apid: window.capsuiteGetApid(),
                capsuite_sid:  window.capsuiteGetSid(),
            });
        }
    })();
    </script>
    <?php
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PHP-SIDE _ap_id for FluentForms (shortcode integration)
// ─────────────────────────────────────────────────────────────────────────────

// Set _ap_id cookie server-side so it's available in PHP (e.g. FluentForms hidden field)
add_action('init', function() {
    if (!isset($_COOKIE['_ap_id'])) {
        $value  = substr(str_shuffle(str_repeat('0123456789abcdefghijklmnopqrstuvwxyz', 6)), 0, 16);
        $domain = $_SERVER['HTTP_HOST'];
        setcookie('_ap_id', $value, time() + 10 * 365 * 24 * 3600, '/', $domain, is_ssl(), true);
        $_COOKIE['_ap_id'] = $value;
    }
});

// FluentForms shortcode: {cookie_ap_id}
add_filter('fluentform/editor_shortcodes', function($shortcodes) {
    $shortcodes[0]['shortcodes']['{cookie_ap_id}'] = 'Capsuite Visitor ID (_ap_id)';
    return $shortcodes;
});
add_filter('fluentform/editor_shortcode_callback_cookie_ap_id', function($value, $form) {
    return sanitize_text_field($_COOKIE['_ap_id'] ?? '');
}, 10, 2);

// ─────────────────────────────────────────────────────────────────────────────
// 4. URL PATTERN MATCHING
// ─────────────────────────────────────────────────────────────────────────────

function capsuite_url_matches($display_urls_raw) {
    if (empty(trim($display_urls_raw))) return false;

    $path = rtrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/') ?: '/';
    $patterns = array_filter(array_map('trim', explode("\n", $display_urls_raw)));

    foreach ($patterns as $pattern) {
        if ($pattern === '*') return true;
        $clean = trim($pattern, '/');
        if (strpos($pattern, '*') !== false) {
            $regex = '/' . str_replace('\*', '.*', preg_quote($clean, '/')) . '/i';
            if (preg_match($regex, $path)) return true;
        } else {
            if (
                strcasecmp(trim($path, '/'), $clean) === 0 ||
                stripos($path, '/' . $clean) !== false
            ) return true;
        }
    }
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. POPUP RENDERING  (injected before </body>)
// ─────────────────────────────────────────────────────────────────────────────

add_action('wp_footer', 'capsuite_popup_script', 20);
function capsuite_popup_script() {
    $company_id       = get_option('capsuite_company_id', '');
    $display_urls_raw = get_option('capsuite_display_urls', '');
    $position         = get_option('capsuite_popup_position', 'center');
    $max_width        = max(200, intval(get_option('capsuite_popup_width',  600)));
    $max_height       = max(100, intval(get_option('capsuite_popup_height', 500)));

    if (empty(trim($company_id))) return;
    if (!capsuite_url_matches($display_urls_raw)) return;

    global $post;
    if (!$post) return;
    $post_url = get_permalink($post->ID);
    if (!$post_url) return;

    // CSS position map
    $position_css = [
        'center'       => 'justify-content:center;align-items:center;',
        'bottom-right' => 'justify-content:flex-end;align-items:flex-end;padding:20px;',
        'bottom-left'  => 'justify-content:flex-start;align-items:flex-end;padding:20px;',
        'top-right'    => 'justify-content:flex-end;align-items:flex-start;padding:20px;',
        'top-left'     => 'justify-content:flex-start;align-items:flex-start;padding:20px;',
    ];
    $pos_css = $position_css[$position] ?? $position_css['center'];
    ?>
    <script>
    (function() {
        var COMPANY_ID  = '<?php echo esc_js($company_id); ?>';
        var POST_URL    = '<?php echo esc_js($post_url); ?>';
        var MAX_WIDTH   = <?php echo intval($max_width); ?>;
        var MAX_HEIGHT  = <?php echo intval($max_height); ?>;
        var POS_CSS     = '<?php echo esc_js($pos_css); ?>';

        var API_BASE    = 'https://interaction-services.capsuite.co/interaction';
        var retrieveUrl = API_BASE + '/retrieve';
        var submitUrl   = API_BASE + '/submit-form';

        var capsuiteApid = window.capsuiteGetApid ? window.capsuiteGetApid() : '';
        var capsuiteSid  = window.capsuiteGetSid  ? window.capsuiteGetSid()  : '';

        if (!capsuiteApid || !capsuiteSid) return;

        // ── Build overlay container ───────────────────────────────────────
        var overlay = document.createElement('div');
        overlay.id = 'capsuite-overlay';
        overlay.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100%;height:100%;' +
            'background:rgba(0,0,0,0.6);z-index:99999;box-sizing:border-box;' + POS_CSS;

        var box = document.createElement('div');
        box.id = 'capsuite-popup-box';
        box.style.cssText = 'position:relative;background:#fff;border-radius:12px;' +
            'width:90%;max-width:' + MAX_WIDTH + 'px;max-height:' + MAX_HEIGHT + 'px;' +
            'overflow:auto;box-shadow:0 4px 24px rgba(0,0,0,.18);box-sizing:border-box;';

        var closeBtn = document.createElement('button');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = 'position:absolute;right:12px;top:12px;background:none;border:none;' +
            'font-size:26px;cursor:pointer;z-index:1;color:#555;line-height:1;padding:0;';
        closeBtn.addEventListener('mouseover', function() { this.style.color = '#000'; });
        closeBtn.addEventListener('mouseout',  function() { this.style.color = '#555'; });

        box.appendChild(closeBtn);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        var interactionId  = null;
        var cdpReferenceId = null;

        // ── Close popup ───────────────────────────────────────────────────
        function closePopup() {
            overlay.style.display = 'none';
            sendAction('close_interaction');
        }

        closeBtn.addEventListener('click', closePopup);
        overlay.addEventListener('click', function(e) { if (e.target === overlay) closePopup(); });
        document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closePopup(); });

        // ── Send activity event ───────────────────────────────────────────
        function sendAction(actionType, extra) {
            var params = new URLSearchParams({
                action_type:  actionType,
                company_id:   COMPANY_ID,
                capsuite_sid: capsuiteSid,
                capsuite_apid: capsuiteApid,
                post_url:     POST_URL,
            });
            if (interactionId)  params.set('interaction_id',   interactionId);
            if (cdpReferenceId) params.set('cdp_reference_id', cdpReferenceId);
            if (extra) {
                Object.keys(extra).forEach(function(k) { params.set(k, extra[k]); });
            }
            var url = submitUrl + '?' + params.toString();
            if (navigator.sendBeacon) {
                navigator.sendBeacon(url);
            } else {
                fetch(url, { method: 'POST', keepalive: true }).catch(function(){});
            }
        }

        // ── Link click tracking ───────────────────────────────────────────
        function trackLinkClick(link, method) {
            var href = link.href || link.getAttribute('href') || '';
            if (!href || href.startsWith('javascript:')) return;
            sendAction('click_interaction', {
                link_url:    href,
                link_text:   (link.innerText || '').substring(0, 100),
                link_target: link.target || '_self',
                open_method: method,
            });
        }

        function attachLinkTracking(content) {
            content.querySelectorAll('a').forEach(function(link) {
                link.addEventListener('mousedown', function(e) {
                    var method = e.button === 1 ? 'middle_click' :
                                 e.button === 2 ? 'right_click' :
                                 (e.ctrlKey || e.metaKey) ? 'ctrl_click' :
                                 link.target === '_blank' ? 'new_tab' : 'left_click';
                    trackLinkClick(link, method);
                    if (e.button === 0 && !e.ctrlKey && !e.metaKey && link.target !== '_blank') {
                        e.preventDefault();
                        var dest = link.href;
                        setTimeout(function() { window.location.href = dest; }, 80);
                    }
                });
            });
        }

        // ── Form submission tracking (email collection) ───────────────────
        function attachFormTracking(content) {
            content.querySelectorAll('form').forEach(function(form) {
                form.addEventListener('submit', function(e) {
                    var emailInput = form.querySelector('input[type="email"], input[name="email"]');
                    var email = emailInput ? emailInput.value.trim() : '';
                    sendAction('email_collection', email ? { email: email } : {});
                });
            });
        }

        // ── Fetch and render popup ────────────────────────────────────────
        var params = new URLSearchParams({
            company_id:    COMPANY_ID,
            capsuite_sid:  capsuiteSid,
            capsuite_apid: capsuiteApid,
            post_url:      POST_URL,
        });

        fetch(retrieveUrl + '?' + params.toString(), { signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined })
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(data) {
                if (!data || !data.interaction || !data.interaction.content) return;

                var ia = data.interaction;
                interactionId  = ia.id || null;
                cdpReferenceId = ia.cdp_reference_id || null;

                var content = document.createElement('div');
                content.style.cssText = 'width:100%;box-sizing:border-box;';
                content.innerHTML = ia.content;

                // Sanitise images and block-level elements
                content.querySelectorAll('img').forEach(function(img) {
                    img.style.maxWidth = '100%';
                    img.style.height   = 'auto';
                });
                content.querySelectorAll('*').forEach(function(el) {
                    el.style.maxWidth    = '100%';
                    el.style.boxSizing   = 'border-box';
                });

                attachLinkTracking(content);
                attachFormTracking(content);

                box.insertBefore(content, closeBtn);
                overlay.style.display = 'flex';
            })
            .catch(function() { /* silently fail if service unreachable */ });
    })();
    </script>
    <?php
}
