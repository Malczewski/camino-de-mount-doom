using Toybox.Communications;
using Toybox.Lang;
using Toybox.WatchUi;

class AppInputDelegate extends WatchUi.InputDelegate {

    function initialize() {
        InputDelegate.initialize();
    }

    function onKey(keyEvent as WatchUi.KeyEvent) as Lang.Boolean {
        var key = keyEvent.getKey();
        Logger.log("onKey: " + key);

        if (key == WatchUi.KEY_DOWN) {
            shiftPage(1);
            return true;
        }
        if (key == WatchUi.KEY_UP) {
            shiftPage(-1);
            return true;
        }
        if (key == WatchUi.KEY_ENTER) {
            var webIdx = calcTotalPages() - 1;
            if (gCurrentPage == webIdx) {
                Communications.openWebPage(WEB_APP_URL, null, null);
                return true;
            }
            // In multi-group mode only: push member detail view for the selected group
            var groups = gGroupData;
            if (groups != null && groups.size() > 1 && gCurrentPage < groups.size()) {
                var group = groups[gCurrentPage] as Lang.Dictionary;
                var detailView = new MemberDetailView(group);
                WatchUi.pushView(detailView, new MemberDetailDelegate(detailView), WatchUi.SLIDE_LEFT);
                return true;
            }
        }
        return false;
    }

    function onSwipe(swipeEvent as WatchUi.SwipeEvent) as Lang.Boolean {
        var dir = swipeEvent.getDirection();
        Logger.log("onSwipe: " + dir);
        if (dir == WatchUi.SWIPE_UP) {
            shiftPage(1);
            return true;
        }
        if (dir == WatchUi.SWIPE_DOWN) {
            shiftPage(-1);
            return true;
        }
        return false;
    }

    private function shiftPage(delta as Lang.Number) as Void {
        var tp = calcTotalPages();
        gCurrentPage = ((gCurrentPage + delta) + tp) % tp;
        Logger.log("page -> " + gCurrentPage + "/" + tp);
        WatchUi.requestUpdate();
    }
}
