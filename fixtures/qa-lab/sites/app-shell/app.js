// Lumenboard: a fictional product. This page is a Crawlmouse QA fixture whose HTML is an empty
// #root; everything a reader sees is built here, after load, as a client-rendered app would.
(function () {
  var views = {
    '/': [
      'Plan your week on one board',
      'Lumenboard lays out tasks, notes and deadlines on a single page, so a small team can see the week at a glance.',
    ],
    '/features': [
      'Features',
      'Boards, checklists, due dates and a calm weekly summary every Monday morning.',
    ],
    '/pricing': [
      'Pricing',
      'Free for three people. Teams pay a flat monthly fee, with no per-seat surprises.',
    ],
  };
  function render() {
    var path = location.pathname.replace(/\/$/, '') || '/';
    var v = views[path] || ['Not found', 'That page does not exist in this fictional app.'];
    var root = document.getElementById('root');
    root.innerHTML = '';
    var header = document.createElement('header');
    header.className = 'site';
    ['/', '/features', '/pricing'].forEach(function (href) {
      var a = document.createElement('a');
      a.href = href;
      a.textContent = views[href][0];
      a.style.marginRight = '16px';
      header.appendChild(a);
    });
    var main = document.createElement('main');
    var h1 = document.createElement('h1');
    h1.textContent = v[0];
    var p = document.createElement('p');
    p.textContent = v[1];
    main.appendChild(h1);
    main.appendChild(p);
    var foot = document.createElement('footer');
    foot.className = 'site';
    foot.textContent = 'A fictional product: a Crawlmouse QA test site. Nothing here is real.';
    root.appendChild(header);
    root.appendChild(main);
    root.appendChild(foot);
  }
  render();
})();
