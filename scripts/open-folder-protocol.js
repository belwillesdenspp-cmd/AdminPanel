(function () {
  if (!WScript.Arguments.Count) WScript.Quit(1);
  var raw = String(WScript.Arguments(0));
  var colon = raw.indexOf(':');
  if (colon >= 0) raw = raw.substring(colon + 1);
  try {
    raw = decodeURIComponent(raw);
  } catch (e) {}
  raw = String(raw)
    .replace(/\//g, '\\')
    .replace(/"/g, '')
    .replace(/\0/g, '')
    .replace(/^\s+|\s+$/g, '');
  if (raw.indexOf('\\\\') !== 0) WScript.Quit(2);
  if (raw.indexOf('..') >= 0) WScript.Quit(3);
  if (/[&|<>^]/.test(raw)) WScript.Quit(4);
  var sh = new ActiveXObject('WScript.Shell');
  sh.Run('explorer.exe "' + raw + '"', 1, false);
})();
