// Cage Tracker Service Worker -- zeigt Browser-Push-Benachrichtigungen an und
// öffnet beim Antippen den betreffenden X-Post. Läuft im Hintergrund, auch wenn
// die Seite selbst gerade nicht offen ist (Voraussetzung: Browser/Gerät unterstützt
// Web Push -- siehe README.md für die iOS-Einschränkung).

self.addEventListener("push", function(event){
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch(e){}
  var title = data.title || "Cage Tracker";
  var options = {
    body: data.body || "",
    data: { url: data.url || self.registration.scope }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", function(event){
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(clients.openWindow(url));
});
