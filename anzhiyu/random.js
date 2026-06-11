var posts=["2026/06/11/Claude-Code使用技巧篇/","2026/06/11/hello-world/"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };