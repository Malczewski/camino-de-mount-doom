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
var gTotalSteps as Lang.Float = 3000000.0;

const WEB_APP_URL = "https://camino-de-mount-doom.netlify.app";

// Total pages in the current navigation flow.
// Single-group: 1 overview + N member pages + 1 web link.
// Multi-group:  N group pages + 1 web link.
function formatDaysOnRoad(days as Lang.Number) as Lang.String {
    var rem100 = days % 100;
    var rem10 = days % 10;
    var key;
    if (rem100 >= 11 && rem100 <= 19) {
        key = Rez.Strings.DaysOnRoad;
    } else if (days == 1) {
        key = Rez.Strings.DaysOnRoad1;
    } else if (rem10 == 1) {
        key = Rez.Strings.DaysOnRoad21;  // 21, 31, ... — Ukrainian: "день", English: "days"
    } else if (rem10 >= 2 && rem10 <= 4) {
        key = Rez.Strings.DaysOnRoad24;
    } else {
        key = Rez.Strings.DaysOnRoad;
    }
    return Lang.format(WatchUi.loadResource(key) as Lang.String, [days]);
}

function calcTotalPages() as Lang.Number {
    var g = gGroupData;
    if (g == null || g.size() == 0) { return 1; }
    if (g.size() == 1) {
        var m = (g[0] as Lang.Dictionary).get("members");
        var cnt = m instanceof Lang.Array ? (m as Lang.Array).size() : 0;
        return 1 + cnt + 1;
    }
    return g.size() + 1;
}

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
            var dict = data as Lang.Dictionary;
            var groups = dict.get("groups");
            gGroupData = groups instanceof Lang.Array ? groups as Lang.Array : new [0];
            var tsObj = dict.get("totalSteps");
            if (tsObj instanceof Lang.Number) { gTotalSteps = (tsObj as Lang.Number).toFloat(); }
            else if (tsObj instanceof Lang.Long) { gTotalSteps = (tsObj as Lang.Long).toFloat(); }
            else if (tsObj instanceof Lang.Float) { gTotalSteps = tsObj as Lang.Float; }
            var tp = calcTotalPages();
            if (gCurrentPage >= tp) { gCurrentPage = 0; }
        } else {
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
        return calcTotalPages();
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

        var tp = calcTotalPages();
        var webIdx = tp - 1;

        if (gCurrentPage == webIdx) {
            drawWebAppPage(dc);
        } else if (groups.size() == 1) {
            // Single-group: page 0 = overview (no hint), pages 1..N = inline member details
            if (gCurrentPage == 0) {
                drawGroupPage(dc, groups[0] as Lang.Dictionary);
            } else {
                MemberDetailDraw.draw(dc, groups[0] as Lang.Dictionary, gCurrentPage - 1);
            }
        } else {
            // Multi-group: pages 0..N-1 = group overviews
            drawGroupPage(dc, groups[gCurrentPage] as Lang.Dictionary);
        }
        drawPageDots(dc, gCurrentPage, tp);
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
        var mg = (W * 0.12).toNumber();

        // Group name
        var gnameObj = group.get("name");
        var gname = gnameObj instanceof Lang.String
            ? gnameObj as Lang.String
            : WatchUi.loadResource(Rez.Strings.GroupFallback) as Lang.String;
        if (gname.length() > 13) { gname = gname.substring(0, 13) + ".."; }
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (H * 0.22).toNumber(), Graphics.FONT_SMALL, gname,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // "N days on the road" subtitle
        var daysObj = group.get("daysInGroup");
        var days = daysObj instanceof Lang.Number
            ? (daysObj as Lang.Number)
            : (daysObj instanceof Lang.Long ? (daysObj as Lang.Long).toNumber() : 0);
        var daysFont = Graphics.FONT_TINY;
        if (Graphics has :FONT_XTINY) { daysFont = Graphics.FONT_XTINY; }
        dc.setColor(0x888888, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (H * 0.30).toNumber(), daysFont,
            formatDaysOnRoad(days),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Member list — up to 5, name left + XX.XX% right, no progress bars
        var membersObj = group.get("members");
        var members = membersObj instanceof Lang.Array ? membersObj as Lang.Array : new [0];
        var count = members.size() > 5 ? 5 : members.size();

        if (count == 0) {
            dc.setColor(0x888888, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, (H * 0.55).toNumber(), Graphics.FONT_TINY,
                WatchUi.loadResource(Rez.Strings.NoMembers) as Lang.String,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        } else {
            // Single progress line with per-member tick marks
            var barY = (H * 0.365).toNumber();
            var barLineH = 3;
            var barLeft = mg;
            var barWidth = W - mg * 2;

            var myProg = 0.0;
            var allMCount = members.size();
            for (var j = 0; j < allMCount; j++) {
                var mj = members[j];
                if (mj instanceof Lang.Dictionary) {
                    var myFlag = (mj as Lang.Dictionary).get("isCurrentUser");
                    if (myFlag instanceof Lang.Boolean && (myFlag as Lang.Boolean)) {
                        var myGs = MemberDetailDraw.numToFloat((mj as Lang.Dictionary).get("groupSteps"));
                        myProg = myGs / gTotalSteps;
                        if (myProg > 1.0) { myProg = 1.0; }
                        break;
                    }
                }
            }

            dc.setColor(0x333333, Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(barLeft, barY, barWidth, barLineH);
            var greenW = (barWidth * myProg).toNumber();
            if (greenW > 0) {
                dc.setColor(Graphics.COLOR_DK_GREEN, Graphics.COLOR_TRANSPARENT);
                dc.fillRectangle(barLeft, barY, greenW, barLineH);
            }

            for (var k = 0; k < allMCount; k++) {
                var mk = members[k];
                if (!(mk instanceof Lang.Dictionary)) { continue; }
                var mdk = mk as Lang.Dictionary;
                var gs = MemberDetailDraw.numToFloat(mdk.get("groupSteps"));
                var prog = gs / gTotalSteps;
                if (prog > 1.0) { prog = 1.0; }
                var tickX = barLeft + (barWidth * prog).toNumber();
                var tickFlag = mdk.get("isCurrentUser");
                var isYouK = tickFlag instanceof Lang.Boolean && (tickFlag as Lang.Boolean);
                var tickH2 = isYouK ? 11 : 7;
                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.fillRectangle(tickX - 1, barY + barLineH / 2 - tickH2 / 2, 2, tickH2);
            }

            // Member name + percentage list
            var startY = (H * 0.44).toNumber();
            var rowH = (H * 0.105).toNumber();

            for (var i = 0; i < count; i++) {
                var mObj = members[i];
                if (!(mObj instanceof Lang.Dictionary)) { continue; }
                var m = mObj as Lang.Dictionary;
                var rowY = startY + i * rowH;

                var nameObj = m.get("displayName");
                var name = nameObj instanceof Lang.String ? nameObj as Lang.String : "?";
                if (name.length() > 11) { name = name.substring(0, 11) + ".."; }

                var groupStepsF = MemberDetailDraw.numToFloat(m.get("groupSteps"));
                var pct = groupStepsF / gTotalSteps * 100.0;
                if (pct > 100.0) { pct = 100.0; }

                dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(mg, rowY, Graphics.FONT_TINY, name,
                    Graphics.TEXT_JUSTIFY_LEFT | Graphics.TEXT_JUSTIFY_VCENTER);
                dc.setColor(0xCCCCCC, Graphics.COLOR_TRANSPARENT);
                dc.drawText(W - mg, rowY, Graphics.FONT_TINY,
                    pct.format("%.2f") + "%",
                    Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);
            }
        }

    }

    function drawWebAppPage(dc as Graphics.Dc) as Void {
        var W = dc.getWidth();
        var H = dc.getHeight();
        var cx = W / 2;

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (H * 0.36).toNumber(), Graphics.FONT_MEDIUM,
            WatchUi.loadResource(Rez.Strings.WebApp) as Lang.String,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        var urlFont = Graphics.FONT_TINY;
        if (Graphics has :FONT_XTINY) {
            urlFont = Graphics.FONT_XTINY;
        }
        dc.setColor(0xAAAAAA, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (H * 0.54).toNumber(), urlFont,
            "camino-de-mount-doom",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(cx, (H * 0.63).toNumber(), urlFont,
            ".netlify.app",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }

    function drawPageDots(dc as Graphics.Dc, current as Lang.Number, total as Lang.Number) as Void {
        if (total <= 1) { return; }
        var W = dc.getWidth();
        var H = dc.getHeight();
        var dotsY = (H * 0.91).toNumber();

        // Switch to text counter when dots would overflow the circular bezel
        if (total > 10) {
            dc.setColor(0x555555, Graphics.COLOR_TRANSPARENT);
            dc.drawText(W / 2, dotsY, Graphics.FONT_TINY,
                (current + 1).toString() + "/" + total.toString(),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        var r = (W * 0.018).toNumber();
        if (r < 3) { r = 3; }
        var sp = r * 3;
        var startX = (W - (total - 1) * sp) / 2;

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
}
