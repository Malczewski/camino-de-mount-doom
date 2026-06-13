using Toybox.Graphics;
using Toybox.Lang;
using Toybox.WatchUi;

// Shared drawing logic for the member detail screen.
// Called from MemberDetailView (multi-group push mode) and AppView (single-group inline mode).
module MemberDetailDraw {

    function numToFloat(val as Lang.Object or Null) as Lang.Float {
        if (val instanceof Lang.Float) { return val as Lang.Float; }
        if (val instanceof Lang.Double) { return (val as Lang.Double).toFloat(); }
        if (val instanceof Lang.Long) { return (val as Lang.Long).toFloat(); }
        if (val instanceof Lang.Number) { return (val as Lang.Number).toFloat(); }
        return 0.0;
    }

    // Format an integer with comma thousands separators: 52312 → "52,312"
    function formatThousands(n as Lang.Number) as Lang.String {
        if (n < 0) { n = -n; }
        if (n < 1000) { return n.toString(); }
        return formatThousands(n / 1000) + "," + (n % 1000).format("%03d");
    }

    // Draw one member's detail page.  Does NOT draw the counter (X/N) or page
    // dots — the caller handles those.
    function draw(dc as Graphics.Dc, group as Lang.Dictionary, memberIndex as Lang.Number) as Void {
        var W = dc.getWidth();
        var H = dc.getHeight();
        var cx = W / 2;
        var mg = (W * 0.08).toNumber();

        var membersObj = group.get("members");
        var arr = membersObj instanceof Lang.Array ? membersObj as Lang.Array : new [0];
        var sz = arr.size();
        if (sz == 0 || memberIndex >= sz) { return; }

        var mObj = arr[memberIndex];
        if (!(mObj instanceof Lang.Dictionary)) { return; }
        var m = mObj as Lang.Dictionary;

        // Find current user's groupSteps for ahead/behind comparison
        var myGroupSteps = 0.0;
        for (var i = 0; i < sz; i++) {
            var mi = arr[i];
            if (mi instanceof Lang.Dictionary) {
                var flag = (mi as Lang.Dictionary).get("isCurrentUser");
                if (flag instanceof Lang.Boolean && (flag as Lang.Boolean)) {
                    myGroupSteps = numToFloat((mi as Lang.Dictionary).get("groupSteps"));
                    break;
                }
            }
        }

        // ── Name + (you) suffix ─────────────────────────────────────────────
        var nameObj = m.get("displayName");
        var name = nameObj instanceof Lang.String ? nameObj as Lang.String : "?";
        var isYouFlag = m.get("isCurrentUser");
        var isYou = isYouFlag instanceof Lang.Boolean && (isYouFlag as Lang.Boolean);
        if (isYou) {
            if (name.length() > 7) { name = name.substring(0, 7) + ".."; }
            name = name + (WatchUi.loadResource(Rez.Strings.YouSuffix) as Lang.String);
        } else {
            if (name.length() > 12) { name = name.substring(0, 12) + ".."; }
        }
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (H * 0.19).toNumber(), Graphics.FONT_SMALL, name,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // ── Progress bar + XX.XX% ───────────────────────────────────────────
        var groupStepsF = numToFloat(m.get("groupSteps"));
        var progress = groupStepsF / gTotalSteps;
        if (progress > 1.0) { progress = 1.0; }
        var pct = progress * 100.0;
        var pctText = pct.format("%.2f") + "%";

        var barTopY = (H * 0.31).toNumber();
        var barH = 7;
        var pctW = dc.getTextWidthInPixels(pctText, Graphics.FONT_TINY);
        var gap = (W * 0.025).toNumber();
        var barW = W - mg * 2 - pctW - gap;
        var filledW = (barW.toFloat() * progress).toNumber();

        dc.setColor(0x333333, Graphics.COLOR_TRANSPARENT);
        dc.fillRectangle(mg, barTopY, barW, barH);
        if (filledW > 0) {
            dc.setColor(Graphics.COLOR_DK_GREEN, Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(mg, barTopY, filledW, barH);
        }
        dc.setColor(0xCCCCCC, Graphics.COLOR_TRANSPARENT);
        // Raise % so its center lines up with the bar (bar was sitting above the % center)
        dc.drawText(W - mg, barTopY + barH / 2 - 2, Graphics.FONT_TINY, pctText,
            Graphics.TEXT_JUSTIFY_RIGHT | Graphics.TEXT_JUSTIFY_VCENTER);

        // ── +delta% last week ───────────────────────────────────────────────
        var lastWeekF = numToFloat(m.get("lastWeekSteps"));
        var weekPct = lastWeekF / gTotalSteps * 100.0;
        var sign = weekPct >= 0.0 ? "+" : "";
        dc.setColor(0x00CC44, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, (H * 0.44).toNumber(), Graphics.FONT_TINY,
            sign + weekPct.format("%.2f") + "% " +
                (WatchUi.loadResource(Rez.Strings.LastWeek) as Lang.String),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // ── Steps ahead / behind (non-current user only) ────────────────────
        var cpLabelY;
        if (!isYou) {
            var diffF = groupStepsF - myGroupSteps;
            var diffAbs = diffF >= 0.0 ? diffF.toNumber() : (-diffF).toNumber();
            var diffTemplate = diffF >= 0.0
                ? (WatchUi.loadResource(Rez.Strings.StepsAhead) as Lang.String)
                : (WatchUi.loadResource(Rez.Strings.StepsBehind) as Lang.String);
            dc.setColor(0x888888, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, (H * 0.53).toNumber(), Graphics.FONT_TINY,
                Lang.format(diffTemplate, [formatThousands(diffAbs)]),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            cpLabelY = (H * 0.66).toNumber();
        } else {
            cpLabelY = (H * 0.55).toNumber();
        }

        // ── Next checkpoint ─────────────────────────────────────────────────
        var nextCpObj = m.get("nextCheckpoint");
        if (nextCpObj instanceof Lang.Dictionary) {
            var nextCp = nextCpObj as Lang.Dictionary;
            var cpNameObj = nextCp.get("name");
            var cpName = cpNameObj instanceof Lang.String ? cpNameObj as Lang.String : "";
            var cpStepsObj = nextCp.get("stepsAway");
            var cpSteps = 0;
            if (cpStepsObj instanceof Lang.Number) {
                cpSteps = cpStepsObj as Lang.Number;
            } else if (cpStepsObj instanceof Lang.Long) {
                cpSteps = (cpStepsObj as Lang.Long).toNumber();
            }

            var cpSmallFont = Graphics.FONT_TINY;
            if (Graphics has :FONT_XTINY) { cpSmallFont = Graphics.FONT_XTINY; }

            // Blue bar above "Next Checkpoint": how far toward this specific stop
            var cpBarLineH = 3;
            var cpBarY = cpLabelY + (H * 0.15).toNumber();
            var cpBarLeft = (W * 0.18).toNumber();
            var cpBarWidth = W - cpBarLeft * 2;
            var cpLegProg = progress;
            var prevCpObj = m.get("prevCheckpoint");
            if (prevCpObj instanceof Lang.Dictionary) {
                var prevStepsF = numToFloat((prevCpObj as Lang.Dictionary).get("steps"));
                var nextAbsF = groupStepsF + cpSteps.toFloat();
                var legLen = nextAbsF - prevStepsF;
                if (legLen > 0.0) {
                    cpLegProg = (groupStepsF - prevStepsF) / legLen;
                    if (cpLegProg < 0.0) { cpLegProg = 0.0; }
                    if (cpLegProg > 1.0) { cpLegProg = 1.0; }
                }
            }
            var cpBlueW = (cpBarWidth * cpLegProg).toNumber();
            dc.setColor(0x333333, Graphics.COLOR_TRANSPARENT);
            dc.fillRectangle(cpBarLeft, cpBarY, cpBarWidth, cpBarLineH);
            if (cpBlueW > 0) {
                dc.setColor(0x0055CC, Graphics.COLOR_TRANSPARENT);
                dc.fillRectangle(cpBarLeft, cpBarY, cpBlueW, cpBarLineH);
            }

            dc.setColor(0x888888, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cpLabelY, cpSmallFont,
                WatchUi.loadResource(Rez.Strings.NextCheckpoint) as Lang.String,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cpLabelY + (H * 0.09).toNumber(), Graphics.FONT_TINY, cpName,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

            dc.setColor(0x888888, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cpLabelY + (H * 0.20).toNumber(), cpSmallFont,
                Lang.format(WatchUi.loadResource(Rez.Strings.InSteps) as Lang.String,
                    [formatThousands(cpSteps)]),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        } else {
            dc.setColor(0x888888, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, cpLabelY, Graphics.FONT_TINY,
                WatchUi.loadResource(Rez.Strings.JourneyComplete) as Lang.String,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }
}

// Per-member detail screen.  Pushed from AppView when the user presses SELECT
// on a group page in multi-group mode.  UP/DOWN cycles through members; BACK pops.
class MemberDetailView extends WatchUi.View {

    private var mGroup as Lang.Dictionary;
    var mMemberIndex as Lang.Number = 0;  // readable by MemberDetailDelegate

    function initialize(group as Lang.Dictionary) {
        View.initialize();
        mGroup = group;
        // Start at the current user so they see their own stats first
        var membersObj = mGroup.get("members");
        if (membersObj instanceof Lang.Array) {
            var arr = membersObj as Lang.Array;
            for (var i = 0; i < arr.size(); i++) {
                var mi = arr[i];
                if (mi instanceof Lang.Dictionary) {
                    var flag = (mi as Lang.Dictionary).get("isCurrentUser");
                    if (flag instanceof Lang.Boolean && (flag as Lang.Boolean)) {
                        mMemberIndex = i;
                        break;
                    }
                }
            }
        }
    }

    function nextMember() as Void {
        var membersObj = mGroup.get("members");
        if (membersObj instanceof Lang.Array) {
            var sz = (membersObj as Lang.Array).size();
            if (sz > 0) {
                mMemberIndex = (mMemberIndex + 1) % sz;
                WatchUi.requestUpdate();
            }
        }
    }

    function prevMember() as Void {
        var membersObj = mGroup.get("members");
        if (membersObj instanceof Lang.Array) {
            var sz = (membersObj as Lang.Array).size();
            if (sz > 0) {
                mMemberIndex = (mMemberIndex + sz - 1) % sz;
                WatchUi.requestUpdate();
            }
        }
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();

        var membersObj = mGroup.get("members");
        if (!(membersObj instanceof Lang.Array) || (membersObj as Lang.Array).size() == 0) {
            dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_SMALL,
                WatchUi.loadResource(Rez.Strings.NoMembers) as Lang.String,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        var arr = membersObj as Lang.Array;
        var sz = arr.size();
        if (mMemberIndex >= sz) { mMemberIndex = 0; }

        MemberDetailDraw.draw(dc, mGroup, mMemberIndex);

        // Counter (X/N) — only in pushed mode; page dots handle navigation in single-group mode
        if (sz > 1) {
            var cx = dc.getWidth() / 2;
            var H = dc.getHeight();
            dc.setColor(0x555555, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, (H * 0.93).toNumber(), Graphics.FONT_TINY,
                (mMemberIndex + 1).toString() + " / " + sz.toString(),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
    }
}

class MemberDetailDelegate extends WatchUi.InputDelegate {

    private var mView as MemberDetailView;

    function initialize(view as MemberDetailView) {
        InputDelegate.initialize();
        mView = view;
    }

    function onKey(keyEvent as WatchUi.KeyEvent) as Lang.Boolean {
        var key = keyEvent.getKey();
        if (key == WatchUi.KEY_DOWN) {
            mView.nextMember();
            return true;
        }
        if (key == WatchUi.KEY_UP) {
            mView.prevMember();
            return true;
        }
        // Let KEY_ESC / KEY_BACK fall through so the system pops the view
        return false;
    }

    function onSwipe(swipeEvent as WatchUi.SwipeEvent) as Lang.Boolean {
        var dir = swipeEvent.getDirection();
        if (dir == WatchUi.SWIPE_UP) {
            mView.nextMember();
            return true;
        }
        if (dir == WatchUi.SWIPE_DOWN) {
            mView.prevMember();
            return true;
        }
        if (dir == WatchUi.SWIPE_RIGHT) {
            WatchUi.popView(WatchUi.SLIDE_RIGHT);
            return true;
        }
        return false;
    }
}
