using Toybox.System;

(:background)
class BackgroundService extends System.ServiceDelegate {

    function initialize() {
        ServiceDelegate.initialize();
    }

    function onTemporalEvent() as Void {
        onBackgroundData(null);
    }

    function onBackgroundData(data as Application.PersistableType) as Void {
        StepSync.sync();
    }
}
