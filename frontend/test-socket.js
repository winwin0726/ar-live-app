const { io } = require("socket.io-client");
const socket = io("http://localhost:3001");
socket.on("connect", () => {
    console.log("Connected");
    socket.emit("sendMessage", { sender: "시스템", type: "system", text: "cmd_open_ar_preview" });
    setTimeout(() => {
        socket.emit("sendMessage", { sender: "시스템", type: "system", text: "cmd_ar_param:jawline:30" });
        setTimeout(() => process.exit(0), 1000);
    }, 1000);
});
socket.on("connect_error", (err) => console.log(err));
