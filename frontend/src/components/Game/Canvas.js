import React, { useEffect, useRef, useState, useCallback } from "react";
import collisions from "../../utils/collisions";
import Sprite from "./Sprite";
import io from "socket.io-client";
import "./styles.css";
import useGame from "./useGame";
import Chat from "./chat";
import { MessageCircle } from "lucide-react";
import axios from "axios";

const Canvas = () => {
  const canvasRef = useRef(null);
  const [ctx, setCtx] = useState(null);
  const socketRef = useRef(null);
  const animationFrameRef = useRef(null);
  const keysRef = useRef({
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
    e: false,
  });
  const [showChat, setShowChat] = useState(false);
  const [showNameModal, setShowNameModal] = useState(true);
  const [tempPlayerName, setTempPlayerName] = useState("");
  const [incomingCall, setIncomingCall] = useState(null);
  const [videoCall, setVideoCall] = useState({
    active: false,
    localStream: null,
    remoteStream: null,
  });
  const peerConnectionRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localVideoRef = useRef(null);
  const [callPeerId, setCallPeerId] = useState(null);
  const [iceConfig, setIceConfig] = useState(null); // <-- Add ICE config state

  const {
    player,
    setPlayer,
    otherPlayers,
    setOtherPlayers,
    boundaries,
    interactionMenu,
    playerName,
    setPlayerName,
    playerCount,
    setPlayerCount,
    gameContainerRef,
    checkCollision,
    findValidSpawnPosition,
    checkPlayerInteraction,
    checkNearbyPlayers,
    mapImage,
    backgroundImage,
    playerImages,
    isInArea2,
    meetingRoomCall,
    setMeetingRoomCall,
  } = useGame(canvasRef, socketRef, keysRef);

  // Initialize canvas and socket
  const SOCKET_URL = "https://gather-here-we-go-again-production.up.railway.app/" // your production backend URL
      

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    setCtx(context);
    socketRef.current = io(SOCKET_URL, { transports: ["websocket"] }); // use correct URL and force websocket

    return () => {
      socketRef.current.disconnect();
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  // Fetch ICE servers from backend on mount
  useEffect(() => {
    const fetchIceServers = async () => {
      try {
        const res = await axios.get("/api/ice-token");
        setIceConfig(res.data); // expects { iceServers: [...] }
      } catch (err) {
        console.error("Failed to fetch ICE servers:", err);
        // fallback to public STUN if needed
        setIceConfig({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      }
    };
    fetchIceServers();
  }, []);

  // Handle name submission
  const handleNameSubmit = () => {
    if (!tempPlayerName.trim()) return alert("Please enter a valid name");
    setPlayerName(tempPlayerName);
    setShowNameModal(false);

    // Register the name with the socket
    if (socketRef.current) {
      socketRef.current.emit("register", tempPlayerName);
    }
  };

  // Game initialization - now depends on playerName being set
  useEffect(() => {
    if (!ctx || !socketRef.current || !playerName || !mapImage) return;

    const initialPlayer = new Sprite({
      position: findValidSpawnPosition(),
      image: playerImages.down,
      frames: { max: 4 },
      sprites: playerImages,
      name: playerName,
      speed: 3,
    });
    setPlayer(initialPlayer);
  }, [
    ctx,
    playerName,
    setPlayer,
    findValidSpawnPosition,
    mapImage,
    playerImages,
  ]);

  // Handle key presses for interaction
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "e" || e.key === "E") {
        checkPlayerInteraction();
      }
      if (e.key in keysRef.current) {
        keysRef.current[e.key] = true;
      }
    };

    const handleKeyUp = (e) => {
      if (e.key in keysRef.current) {
        keysRef.current[e.key] = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [checkPlayerInteraction]);

  // Mouse events for interaction menu
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      interactionMenu.current.handleMouseMove(mouseX, mouseY);
    };

    const handleClick = (e) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      interactionMenu.current.handleClick(otherPlayers);
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("click", handleClick);

    return () => {
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("click", handleClick);
    };
  }, [otherPlayers]);

  // Listen for incoming call popup
  useEffect(() => {
    if (!socketRef.current) return;
    const handleReceiveCall = (data) => {
      setIncomingCall(data);
    };
    socketRef.current.on("receiveCall", handleReceiveCall);
    return () => {
      socketRef.current.off("receiveCall", handleReceiveCall);
    };
  }, []);

  // Patch interaction menu to trigger call
  useEffect(() => {
    if (!interactionMenu.current) return;
    const originalHandleClick = interactionMenu.current.handleClick.bind(
      interactionMenu.current
    );
    interactionMenu.current.handleClick = (otherPlayers) => {
      if (
        interactionMenu.current.visible &&
        interactionMenu.current.selectedOption === "voiceChat" &&
        interactionMenu.current.targetId
      ) {
        // Initialize caller's side of the call
        setCallPeerId(interactionMenu.current.targetId);
        setVideoCall((vc) => ({ ...vc, active: true }));

        // Send call event to server
        if (socketRef.current) {
          socketRef.current.emit("callUser", {
            targetId: interactionMenu.current.targetId,
            callerName: playerName,
          });
        }
        interactionMenu.current.hide();
        return true;
      }
      return originalHandleClick(otherPlayers);
    };
    return () => {
      interactionMenu.current.handleClick = originalHandleClick;
    };
  }, [interactionMenu, playerName]);

  // Accept incoming call
  const handleAcceptCall = async () => {
    try {
      if (!iceConfig) return; // Wait for ICE config
      setIncomingCall(null);
      setCallPeerId(incomingCall.callerId);
      console.log(incomingCall);
      setVideoCall((vc) => ({ ...vc, active: true }));

      // Get local media
      const localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      console.log("Got local stream:", localStream.getTracks());
      setVideoCall((vc) => ({ ...vc, localStream }));

      // Create peer connection
      const pc = new window.RTCPeerConnection(iceConfig); // Use dynamic ICE config
      peerConnectionRef.current = pc;

      pc.oniceconnectionstatechange = () => {
        console.log("ICE connection state:", pc.iceConnectionState);
      };

      // Add local tracks
      localStream.getTracks().forEach((track) => {
        console.log("Adding local track:", track.kind);
        pc.addTrack(track, localStream);
      });

      // Send ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          console.log("Sending ICE candidate:", event.candidate);
          socketRef.current.emit("ice-candidate", {
            to: incomingCall.callerId,
            candidate: event.candidate,
          });
        }
      };

      // Receive remote stream
      pc.ontrack = (event) => {
        console.log("Received remote track:", event.track.kind);
        if (event.streams && event.streams[0]) {
          console.log("Setting remote stream");
          setVideoCall((vc) => ({ ...vc, remoteStream: event.streams[0] }));
        }
      };

      // Remove any existing listeners
      socketRef.current.off("offer");
      socketRef.current.off("ice-candidate");

      // Create and send answer
      socketRef.current.on("offer", async ({ from, offer }) => {
        console.log("Received offer, creating answer");
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socketRef.current.emit("answer", { to: from, answer });
      });

      // Listen for ICE candidates
      socketRef.current.on("ice-candidate", async ({ candidate }) => {
        try {
          if (candidate) {
            console.log("Received ICE candidate");
            if (pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } else {
              console.log(
                "Waiting for remote description before adding ICE candidate"
              );
            }
          }
        } catch (err) {
          console.error("Error adding received ICE candidate:", err);
        }
      });

      // Notify caller to start offer
      socketRef.current.emit("acceptCall", { to: incomingCall.callerId });
    } catch (error) {
      console.error("Error in handleAcceptCall:", error);
      handleEndCall();
    }
  };

  // Initiate call as caller
  useEffect(() => {
    if (!callPeerId || !videoCall.active || !iceConfig) return; // Wait for ICE config

    let pc;
    let localStream;

    const startCaller = async () => {
      try {
        // Clean up any existing connection
        if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
          peerConnectionRef.current = null;
        }

        // Get local media
        localStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        console.log("Caller got local stream:", localStream.getTracks());
        setVideoCall((vc) => ({ ...vc, localStream }));

        pc = new window.RTCPeerConnection(iceConfig); // Use dynamic ICE config
        peerConnectionRef.current = pc;

        pc.oniceconnectionstatechange = () => {
          console.log("Caller ICE connection state:", pc.iceConnectionState);
        };

        // Add local tracks
        localStream.getTracks().forEach((track) => {
          console.log("Caller adding track:", track.kind);
          pc.addTrack(track, localStream);
        });

        // ICE candidates
        pc.onicecandidate = (event) => {
          if (event.candidate && socketRef.current) {
            console.log("Caller sending ICE candidate:", event.candidate);
            socketRef.current.emit("ice-candidate", {
              to: callPeerId,
              candidate: event.candidate,
            });
          }
        };

        // Remote stream
        pc.ontrack = (event) => {
          console.log("Caller received track:", event.track.kind);
          if (event.streams && event.streams[0]) {
            console.log("Caller setting remote stream");
            setVideoCall((vc) => ({ ...vc, remoteStream: event.streams[0] }));
          }
        };

        // Remove existing listeners
        socketRef.current.off("answer");
        socketRef.current.off("ice-candidate");
        socketRef.current.off("acceptCall");

        // Set up new listeners
        socketRef.current.on("answer", async ({ answer }) => {
          console.log("Received answer from callee");
          if (pc.signalingState !== "closed") {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
          }
        });

        socketRef.current.on("ice-candidate", async ({ candidate }) => {
          try {
            if (candidate && pc.remoteDescription) {
              console.log("Caller received ICE candidate");
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            }
          } catch (err) {
            console.error("Error adding received ICE candidate:", err);
          }
        });

        // When receiver accepts, create and send offer
        socketRef.current.on("acceptCall", async () => {
          try {
            console.log("Call accepted, creating offer");
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            socketRef.current.emit("offer", { to: callPeerId, offer });
          } catch (error) {
            console.error("Error creating offer:", error);
          }
        });
      } catch (error) {
        console.error("Error in startCaller:", error);
        handleEndCall();
      }
    };

    startCaller();

    return () => {
      console.log("Cleaning up caller effect");
      if (localStream) {
        localStream.getTracks().forEach((track) => track.stop());
      }
      if (pc) {
        pc.close();
      }
    };
  }, [callPeerId, videoCall.active, iceConfig]);

  // Cleanup on call end
  const handleEndCall = () => {
    setVideoCall({ active: false, localStream: null, remoteStream: null });
    setCallPeerId(null);
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      localVideoRef.current.srcObject
        .getTracks()
        .forEach((track) => track.stop());
    }
    if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
      remoteVideoRef.current.srcObject
        .getTracks()
        .forEach((track) => track.stop());
    }
    // Optionally notify peer
    if (socketRef.current && callPeerId) {
      socketRef.current.emit("endCall", { to: callPeerId });
    }
  };

  // Attach streams to video elements with error handling
  useEffect(() => {
    console.log("Attaching streams to video elements");
    if (localVideoRef.current && videoCall.localStream) {
      console.log("Setting local video stream");
      localVideoRef.current.srcObject = videoCall.localStream;
    }
    if (remoteVideoRef.current && videoCall.remoteStream) {
      console.log("Setting remote video stream");
      remoteVideoRef.current.srcObject = videoCall.remoteStream;
    }

    // Add onloadedmetadata handlers
    const localVideo = localVideoRef.current;
    const remoteVideo = remoteVideoRef.current;

    if (localVideo) {
      localVideo.onloadedmetadata = () =>
        console.log("Local video metadata loaded");
      localVideo.onerror = (e) => console.error("Local video error:", e);
    }
    if (remoteVideo) {
      remoteVideo.onloadedmetadata = () =>
        console.log("Remote video metadata loaded");
      remoteVideo.onerror = (e) => console.error("Remote video error:", e);
    }
  }, [videoCall.localStream, videoCall.remoteStream]);

  // Listen for call end from peer
  useEffect(() => {
    if (!socketRef.current) return;
    const handlePeerEnd = () => handleEndCall();
    socketRef.current.on("endCall", handlePeerEnd);
    return () => socketRef.current.off("endCall", handlePeerEnd);
  }, [callPeerId]);

  // Game loop
  const animate = useCallback(() => {
    if (!player || !ctx || !mapImage) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);

    // Draw background
    if (backgroundImage) {
      ctx.drawImage(
        backgroundImage,
        0,
        0,
        canvasRef.current.width,
        canvasRef.current.height
      );
    }

    // Draw map
    ctx.drawImage(mapImage, 0, 0, 1550, 700);

    // --- Draw boundaries (make them visible) ---
    ctx.save();
    ctx.strokeStyle = "rgba(255,0,0,0)"; // Red, semi-transparent
    ctx.lineWidth = 2;
    boundaries.forEach((boundary) => {
      ctx.strokeRect(boundary.x, boundary.y, boundary.width, boundary.height);
    });
    ctx.restore();
    // --- End boundary drawing ---

    // Update player movement
    let moved = false;
    const directions = [
      { key: "ArrowUp", dx: 0, dy: -1, dir: "up" },
      { key: "ArrowDown", dx: 0, dy: 1, dir: "down" },
      { key: "ArrowLeft", dx: -1, dy: 0, dir: "left" },
      { key: "ArrowRight", dx: 1, dy: 0, dir: "right" },
    ];

    directions.forEach(({ key, dx, dy, dir }) => {
      if (keysRef.current[key]) {
        const newX = player.position.x + dx * player.speed;
        const newY = player.position.y + dy * player.speed;

        if (!checkCollision(newX, newY)) {
          player.position.x = newX;
          player.position.y = newY;
          player.setDirection(dir);
          player.moving = true;
          moved = true;
        }
      }
    });

    // Emit movement to server
    if (moved && socketRef.current) {
      socketRef.current.emit("playerMovement", {
        position: player.position,
        direction: player.lastDirection,
        moving: true,
      });
    }

    // Check for nearby players
    checkNearbyPlayers();

    // Draw game elements
    Object.values(otherPlayers).forEach((p) => {
      if (p instanceof Sprite) {
        p.draw(ctx);
      }
    });
    player.draw(ctx);
    interactionMenu.current.draw(ctx);

    animationFrameRef.current = requestAnimationFrame(animate);
  }, [
    player,
    otherPlayers,
    ctx,
    checkCollision,
    checkNearbyPlayers,
    mapImage,
    backgroundImage,
    boundaries,
    interactionMenu,
  ]);

  useEffect(() => {
    if (player && mapImage) {
      animate();
    }
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [animate, player, mapImage]);

  return (
    <div className="game-container" ref={gameContainerRef}>
      {/* Name Input Modal */}
      {showNameModal && (
        <div className="name-modal-backdrop">
          <div className="name-modal">
            <h2 style={{ color: "black" }}>Enter Your Player Name</h2>
            <input
              type="text"
              placeholder="Enter your name"
              value={tempPlayerName}
              onChange={(e) => setTempPlayerName(e.target.value)}
              maxLength="15"
              onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
            />
            <button onClick={handleNameSubmit}>Start Game</button>
          </div>
        </div>
      )}

      <div className="header-bar">
        <div className="game-logo">Virtual Office</div>
        <div className="player-controls">
          <div className="player-name-display">{playerName}</div>
          <div className="player-count">Players: {playerCount}</div>
        </div>
      </div>
      <div style={{ position: "relative" }}>
        <canvas ref={canvasRef} width={1550} height={700} />
        <button
          className="chat-button"
          onClick={() => setShowChat(!showChat)}
          style={{
            position: "absolute",
            bottom: "20px",
            right: "20px",
            backgroundColor: "#4CAF50",
            border: "none",
            borderRadius: "50%",
            width: "50px",
            height: "50px",
            cursor: "pointer",
            boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MessageCircle
            style={{
              width: "30px",
              height: "30px",
            }}
          />
        </button>
      </div>
      {/* Incoming Call Popup */}
      {incomingCall && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.3)",
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "12px",
              padding: "32px 40px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
              textAlign: "center",
              minWidth: "320px",
            }}
          >
            <h2 style={{ marginBottom: 16, color: "#4a6cf7" }}>
              Incoming Call
            </h2>
            <div style={{ marginBottom: 24, fontSize: 18 }}>
              {incomingCall.callerName} is calling you...
            </div>
            <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
              <button
                style={{
                  background: "#4CAF50",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 24px",
                  fontSize: 16,
                  cursor: "pointer",
                }}
                onClick={handleAcceptCall}
              >
                Accept
              </button>
              <button
                style={{
                  background: "#ff4b4b",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 24px",
                  fontSize: 16,
                  cursor: "pointer",
                }}
                onClick={() => setIncomingCall(null)}
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Video Call Modal */}
      {videoCall.active && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.7)",
            zIndex: 3000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: 12,
              padding: 24,
              boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <h2 style={{ color: "#4a6cf7" }}>Video Call</h2>
            <div style={{ display: "flex", gap: 16, margin: "16px 0" }}>
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                style={{ width: 240, borderRadius: 8, background: "#222" }}
              />
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                style={{ width: 240, borderRadius: 8, background: "#222" }}
              />
            </div>
            <button
              style={{
                background: "#ff4b4b",
                color: "white",
                border: "none",
                borderRadius: "6px",
                padding: "10px 24px",
                fontSize: 16,
                cursor: "pointer",
              }}
              onClick={handleEndCall}
            >
              End Call
            </button>
          </div>
        </div>
      )}
      {/* Meeting Room Video Conference */}
      {meetingRoomCall.active && (
        <div
          style={{
            position: "fixed",
            right: "20px",
            top: "20px",
            width: "300px",
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            borderRadius: "10px",
            padding: "10px",
            zIndex: 1000,
          }}
        >
          <h3 style={{ color: "white" }}>Meeting Room</h3>
          {/* Local video */}
          <video
            autoPlay
            muted
            playsInline
            style={{ width: "100%", borderRadius: "5px", marginBottom: "10px" }}
            ref={(el) => {
              if (el && meetingRoomCall.localStream) {
                el.srcObject = meetingRoomCall.localStream;
              }
            }}
          />
          {/* Remote videos */}
          {meetingRoomCall.remoteStreams &&
            Object.entries(meetingRoomCall.remoteStreams).map(
              ([userId, stream]) => (
                <video
                  key={userId + (stream ? stream.id : "")} // force re-render if stream changes
                  autoPlay
                  playsInline
                  style={{
                    width: "100%",
                    borderRadius: "5px",
                    marginBottom: "10px",
                  }}
                  ref={(el) => {
                    if (el && stream) {
                      el.srcObject = stream;
                    }
                  }}
                />
              )
            )}
        </div>
      )}
      {showChat && (
        <div
          style={{
            position: "fixed",
            right: "20px",
            bottom: "80px",
            width: "800px",
            height: "70vh",
            backgroundColor: "white",
            borderRadius: "15px",
            boxShadow:
              "0 10px 25px rgba(0,0,0,0.3), 0 6px 12px rgba(74, 108, 247, 0.2)",
            zIndex: 1000,
            overflow: "hidden",
            border: "2px solid rgba(74, 108, 247, 0.1)",
            background: "linear-gradient(to bottom right, #ffffff, #f0f4ff)",
          }}
        >
          <button
            onClick={() => setShowChat(false)}
            style={{
              position: "absolute",
              right: "10px",
              top: "10px",
              backgroundColor: "#ff4b4b",
              border: "none",
              borderRadius: "50%",
              width: "30px",
              height: "30px",
              color: "white",
              fontSize: "18px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 5px rgba(0,0,0,0.2)",
              zIndex: 1001,
            }}
          >
            ×
          </button>
          <Chat username={playerName} socket={socketRef.current} />
        </div>
      )}
    </div>
  );
};

export default Canvas;
