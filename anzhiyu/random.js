var posts=["pages/Claude-Code深入浅出(技巧篇1)/","pages/Claude-Code是深入浅出-安装篇/"];function toRandomPost(){
    pjax.loadUrl('/'+posts[Math.floor(Math.random() * posts.length)]);
  };