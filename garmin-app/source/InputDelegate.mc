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
            var groups = gGroupData;
            var webIdx = groups != null ? groups.size() : 0;
            if (gCurrentPage == webIdx) {
                Communications.openWebPage(WEB_APP_URL, null, null);
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
        var groups = gGroupData;
        var tp = (groups != null ? groups.size() : 0) + 1;
        gCurrentPage = ((gCurrentPage + delta) + tp) % tp;
        Logger.log("page -> " + gCurrentPage + "/" + tp);
        WatchUi.requestUpdate();
    }
}
