using Toybox.Application;
using Toybox.Communications;
using Toybox.Graphics;
using Toybox.Lang;
using Toybox.WatchUi;

// Global state shared with InputDelegate
var gGroupData as Lang.Array or Null = null;
var gLoadingData as Lang.Boolean = false;
var gCurrentPage as Lang.Number = 0;
var gDataError as Lang.String or Null = null;

const WEB_APP_URL = "https://camino-de-mount-doom.netlify.app";
const TOTAL_STEPS_F = 3000000.0;

class AppView extends WatchUi.View {

    function initialize() {
        View.initialize();
    }

    function onShow() as Void {
        var apiKey = Application.Properties.getValue("api_key");
        var hasKey = apiKey instanceof Lang.String && (apiKey as Lang.String).length() > 0;
        var share = Application.Properties.getValue("share_steps");
        var consent = share instanceof Lang.Boolean && (share as Lang.Boolean);

        if (!hasKey || !consent) {
            return;
        }

        gLoadingData = true;
        gDataError = null;
        WatchUi.requestUpdate();
        GroupDataFetch.fetch(apiKey as Lang.String, method(:onGroupDataResponse));
    }

    function onGroupDataResponse(
        code as Lang.Number,
        data as Lang.Dictionary or Lang.String or Null
    ) as Void {
        gLoadingData = false;
        Logger.log("onGroupDataResponse: code=" + code + " data=" + data);
        if (code == 200 && data instanceof Lang.Dictionary) {
            var groups = (data as Lang.Dictionary).get("groups");
            gGroupData = groups instanceof Lang.Array ? groups as Lang.Array : new [0];
            var tp = totalPages();
            if (gCurrentPage >= tp) { gCurrentPage = 0; }
        } else {
            // Try to show the error message from the response body
            var msg = "Error " + code;
            if (data instanceof Lang.Dictionary) {
                var errBody = (data as Lang.Dictionary).get("error");
                if (errBody instanceof Lang.String) {
                    msg = (errBody as Lang.String) + " (" + code + ")";
                }
            } else if (data instanceof Lang.String) {
                msg = data as Lang.String;
            }
            Logger.log("onGroupDataResponse: error=" + msg);
            gDataError = msg;
        }
        WatchUi.requestUpdate();
    }

    function totalPages() as Lang.Number {
        var g = gGroupData;
        return (g != null ? g.size() : 0) + 1; // +1 for the web app page
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var apiKey = Application.Properties.getValue("api_key");
        var hasKey = apiKey instanceof Lang.String && (apiKey as Lang.String).length() > 0;

        if (!hasKey) {
            drawCentered(dc, WatchUi.loadResource(Rez.Strings.NoApiKey) as Lang.String);
            return;
        }

        var share = Application.Properties.getValue("share_steps");
        var consent = share instanceof Lang.Boolean && (share as Lang.Boolean);

        if (!consent) {
            drawCentered(dc, WatchUi.loadResource(Rez.Strings.EnableSharingPrompt) as Lang.String);
            return;
        }

        if (gLoadingData) {
            drawCentered(dc, WatchUi.loadResource(Rez.Strings.Loading) as Lang.String);
            return;
        }

        if (gDataError != null) {
            drawCentered(dc, gDataError);
            return;
        }

        var groups = gGroupData;
        if (groups == null || groups.size() == 0) {
            drawCentered(dc, WatchUi.loadResource(Rez.Strings.NoGroups) as Lang.String);
            return;
        }

        if (gCurrentPage < groups.size()) {
            drawGroupPage(dc, groups[gCurrentPage] as Lang.Dictionary);
        } else {
            drawWebAppPage(dc);
        }
        drawPageDots(dc, gCurrentPage, totalPages());
    }

    function drawCentered(dc as Graphics.Dc, text as Lang.String) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_SMALL, text,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function drawGroupPage(dc as Graphics.Dc, group as Lang.Dictionary) as Void {
        var W = dc.getWidth();
        var H = dc.getHeight();
        var cx = W / 2;
        var mg = (W * 0.13).toNumber();
        var availW = W - mg * 2;
        // Measure "+99.99%" in FONT_TINY so the bar is always shorter than the text
        var deltaTextW = dc.getTextWidthInPixels("+99.99%", Graphics.FONT_TINY);
        var gap = (W * 0.025).toNumber();
        var barW = availW - deltaTextW - gap;

        // Group name
        var gnameObj = group.get("name");
        var gname = gnameObj instanceof Lang.String ? gnameObj as Lang.String : WatchUi.loadResource(Rez.Strings.GroupFallback) as Lang.String;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (H * 0.12).toNumber(), Graphics.FONT_SMALL, gname,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Member list
        var membersObj = group.get("members");
        var members = membersObj instanceof Lang.Array ? membersObj as Lang.Array : new [0];
        var count = members.size() > 3 ? 3 : members.size();
        if (count == 0) {
            dc.setColor(0x888888, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, (H * 0.55).toNumber(), Graphics.FONT_TINY, WatchUi.loadResource(Rez.Strings.NoMembers) as Lang.String,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        // Fixed row height — never divided by count so layout is identical for 1 or 4 users
        var startY = (H * 0.20).toNumber();
        var rowH = (H * 0.23).toNumber();
        var nameOff = (H * 0.04).toNumber();   // name line: fixed px below row top
        var barOff  = (H * 0.12).toNumber();   // bar line:  fixed px below row top

        for (var i = 0; i < count; i++) {
            var mObj = members[i];
            if (!(mObj instanceof Lang.Dictionary)) { continue; }
            var m = mObj as Lang.Dictionary;
            var rowY = startY + i * rowH;

            var nameObj = m.get("displayName");
            var name = nameObj instanceof Lang.String ? nameObj as Lang.String : "?";
            if (name.length() > 10) { name = name.substring(0, 10) + ".."; }

            var stepsF = numToFloat(m.get("totalSteps"));
            var progress = stepsF / TOTAL_STEPS_F;
            if (progress > 1.0) { progress = 1.0; }

            var weekF = numToFloat(m.get("last7DaysSteps"));
            var weekPct = weekF / TOTAL_STEPS_F * 100.0;
            var totalPct = progress * 100.0;

            // Line 1: name (left) · total% (right)
            var line1Y = rowY + nameOff;
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(mg, line1Y, Graphics.FONT_TINY, name,
                Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
            dc.setColor(0xCCCCCC, Graphics.COLOR_TRANSPARENT);
            dc.drawText(W - mg, line1Y, Graphics.FONT_TINY,
                totalPct.format("%.2f") + "%",
                Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);

            // Line 2: [progress bar] [+delta%]
            var barTopY = rowY + barOff;
            var barH = 7;
            var filledW = (barW.toFloat() * progress).toNumber();

            dc.setColor(0x333333, Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(mg, barTopY, barW, barH);
            if (filledW > 0) {
                dc.setColor(Graphics.COLOR_DK_GREEN, Graphics.COLOR_TRANSPARENT);
                dc.fillRectangle(mg, barTopY, filledW, barH);
            }

            // Delta label: right-aligned at same anchor as total% above — guarantees alignment
            dc.setColor(0x00CC44, Graphics.COLOR_TRANSPARENT);
            dc.drawText(W - mg, barTopY + barH / 2, Graphics.FONT_TINY,
                "+" + weekPct.format("%.2f") + "%",
                Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }

    function drawWebAppPage(dc as Graphics.Dc) as Void {
        var W = dc.getWidth();
        var H = dc.getHeight();
        var cx = W / 2;

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (H * 0.33).toNumber(), Graphics.FONT_MEDIUM, WatchUi.loadResource(Rez.Strings.WebApp) as Lang.String,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0xAAAAAA, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (H * 0.52).toNumber(), Graphics.FONT_TINY,
            "camino-de-mount-doom",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(cx, (H * 0.63).toNumber(), Graphics.FONT_TINY,
            ".netlify.app",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        dc.setColor(0x4488FF, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (H * 0.77).toNumber(), Graphics.FONT_TINY,
            WatchUi.loadResource(Rez.Strings.PressToOpen) as Lang.String,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function drawPageDots(dc as Graphics.Dc, current as Lang.Number, total as Lang.Number) as Void {
        if (total <= 1) { return; }
        var W = dc.getWidth();
        var H = dc.getHeight();
        var r = (W * 0.018).toNumber();
        if (r < 3) { r = 3; }
        var sp = r * 3;
        var startX = (W - (total - 1) * sp) / 2;
        var dotsY = H - (H * 0.06).toNumber();

        for (var i = 0; i < total; i++) {
            if (i == current) {
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(startX + i * sp, dotsY, r);
            } else {
                dc.setColor(0x555555, Graphics.COLOR_TRANSPARENT);
                dc.fillCircle(startX + i * sp, dotsY, r);
            }
        }
    }

    // Safely convert any numeric type coming from JSON to Float
    function numToFloat(val as Lang.Object or Null) as Lang.Float {
        if (val instanceof Lang.Float) { return val as Lang.Float; }
        if (val instanceof Lang.Double) { return (val as Lang.Double).toFloat(); }
        if (val instanceof Lang.Long) { return (val as Lang.Long).toFloat(); }
        if (val instanceof Lang.Number) { return (val as Lang.Number).toFloat(); }
        return 0.0;
    }
}
