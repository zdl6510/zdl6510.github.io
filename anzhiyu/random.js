var posts=["pages/Claude-Code是深入浅出-安装篇/","pages/Claude-Code使用技巧篇/"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };