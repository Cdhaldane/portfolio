import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

import "./Sidebar.css";

const Sidebar = (props) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showAllSubscriptions, setShowAllSubscriptions] = useState(false);

  const navigate = useNavigate();

  let sideBarItems = [
    {
      name: "Home",
      icon: "fa-home",
      event: () => console.log(2),
    },
    {
      name: "Live Tv",
      icon: "fa-tv",
      event: () => console.log(2),
    },
    {
      name: "My Playlist",
      icon: "fa-photo-film",
      event: () => console.log(2),
    },
    {
      name: "Watch Together",
      icon: "fa-users",
      event: () => console.log(2),
    },
    {
      type: "line",
      event: () => console.log(2),
    },
    {
      name: "Streaming Providers",
      type: "title",
      event: () => console.log(2),
    },
    {
      name: "Facebook",
      icon: "fa-brands fa-facebook",
      event: () => console.log(2),
    },
    {
      name: "Twitter",
      icon: "fa-brands fa-twitter",
      event: () => console.log(2),
    },
    {
      name: "Discord",
      icon: "fa-brands fa-discord",
      event: () => console.log(2),
    },
    {
      name: "Show More",
      icon: "fa-chevron-down",
      event: () => console.log(2),
    },
    {
      type: "line",
      event: () => console.log(2),
    },
    {
      name: "Explore",
      type: "title",
      event: () => console.log(2),
    },
    {
      name: "Trending",
      icon: "fa-arrow-trend-up",
      event: () => console.log(2),
    },
    {
      name: "Watch Later",
      icon: "fa-clock",
      event: () => console.log(2),
    },
    {
      name: "Friends Watching",
      icon: "fa-user-group",
      event: () => console.log(2),
    },
    {
      name: "Lives",
      icon: "fa-calendar-days",
      event: () => console.log(2),
    },
    {
      type: "line",
      event: () => console.log(2),
    },
    {
      name: "Subscriptions",
      type: "title",
      event: () => console.log(2),
    },
    {
      name: "Originals",
      icon: "fa-image",
      owner: "subscriptions",
      event: () => console.log(2),
    },
    {
      name: "Gaming",
      icon: "fa-image",
      owner: "subscriptions",
      event: () => console.log(2),
    },
    {
      name: "Music",
      icon: "fa-image",
      owner: "subscriptions",
      event: () => console.log(2),
    },
    {
      name: "Sports",
      icon: "fa-image",
      owner: "subscriptions",
      event: () => console.log(2),
    },
    {
      name: "News",
      icon: "fa-image",
      owner: "subscriptions",
      event: () => console.log(2),
    },
    {
      name: "Movies",
      icon: "fa-image",
      owner: "subscriptions",
      event: () => console.log(2),
    },
    {
      type: "showMore",
      event: () => console.log(2),
    },
    {
      type: "line",
      event: () => console.log(2),
    },
    {
      name: "Settings",
      icon: "fa-cog",
      event: () => console.log(2),
    },
    {
      name: "Privacy Policy",
      icon: "fa-file-contract",
      event: () => console.log(2),
    },
    {
      name: "Help Center",
      icon: "fa-circle-question",
      event: () => console.log(2),
    },
  ];

  useEffect(() => {
    setIsCollapsed(props.isCollapsed);
  }, [props.isCollapsed]);

  const toggleSidebar = () => {
    props.setIsCollapsed(!isCollapsed);
  };

  const toggleShowAllSubscriptions = () => {
    setShowAllSubscriptions(!showAllSubscriptions);
  };

  const renderedSubscriptions = sideBarItems
    .filter((item) => item.owner === "subscriptions")
    .slice(0, showAllSubscriptions ? sideBarItems.length : 3);

  const showMoreLessButton = (i) => (
    <div key={i} className="sidebar-item" onClick={toggleShowAllSubscriptions}>
      <i
        className={`fa-solid ${
          showAllSubscriptions ? "fa-chevron-up" : "fa-chevron-down"
        }`}
      ></i>
      <div className="sidebar-item-name">
        {showAllSubscriptions ? "Show Less" : "Show More"}
      </div>
    </div>
  );

  const sideBar = sideBarItems.map((sideBarItem, index) => {
    if (sideBarItem.owner === "subscriptions" && !props.isPortrait) {
      if (!renderedSubscriptions.includes(sideBarItem)) {
        return null;
      }
    }

    if (sideBarItem.type === "showMore" && !props.isPortrait) {
      return showMoreLessButton(index);
    }

    if (sideBarItem.type === "line" && !props.isPortrait) {
      return <div key={`line-${index}`} className="sidebar-line"></div>;
    }

    if (sideBarItem.type === "title" && !props.isPortrait) {
      return (
        <div key={`title-${index}`} className="sidebar-item-title">
          {sideBarItem.name}
        </div>
      );
    }

    return (
      <div
        key={`item-${sideBarItem.name}`}
        className={`sidebar-item ${
          props.isPortrait && "sidebar-portrait-item"
        }`}
        onClick={sideBarItem.event}
      >
        {sideBarItem.icon && sideBarItem.type === "provider" ? (
          <img
            src={process.env.PUBLIC_URL + `/assets/${sideBarItem.icon}.png`}
            alt={sideBarItem.name}
          />
        ) : (
          sideBarItem.icon &&
          sideBarItem.icon.includes("fa") && (
            <i className={`fa-solid ${sideBarItem.icon}`}></i>
          )
        )}

        {!props.isPortrait && (
          <div className="sidebar-item-name">{sideBarItem.name}</div>
        )}
      </div>
    );
  });

  return (
    <div
      className={`sidebar-container ${isCollapsed && "sidebar-collapsed"} ${
        props.isPortrait && "sidebar-portrait"
      }`}
    >
      <div
        className={`sidebar-title-container ${
          isCollapsed && "sidebar-title-collapsed"
        }
          ${props.isPortrait && "sidebar-portrait"}
        `}
      >
        <i
          onClick={toggleSidebar}
          className={`fa-solid ${isCollapsed ? "fa-bars" : "fa-times"}`}
        ></i>
        {!props.isPortrait && (
          <img
            src={process.env.PUBLIC_URL + "/C_Logo.png"}
            alt="Logo"
            onClick={() => navigate("/")}
          />
        )}
      </div>
      <div
        className={`sidebar-item-container scroll-y ${
          isCollapsed && "sidebar-item-collapsed"
        } ${props.isPortrait && "sidebar-item-portrait"}
        }`}
        onScroll={(e) => {
          console.log(e);
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {sideBar}
      </div>
    </div>
  );
};

export default Sidebar;
