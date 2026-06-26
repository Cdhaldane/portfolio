import CaseStudy from "./CaseStudy";

const Timeslot = () => (
  <CaseStudy
    slug="timeslot"
    name="Timeslot"
    client="@time-slot.ca"
    accent="#3fa86a"
    year="2024"
    role="Full-Stack Developer"
    focus="Database design with Supabase, custom calendar component, responsive frontend & backend integration"
    url="https://time-slot.ca"
    summary="Appointment scheduling for small businesses — full-stack development of a booking app for a local salon."
    cover="/assets/timeslot/header-{theme}.png"
    coverAlt="Time-Slot scheduling app"
    sections={[
      {
        type: "text",
        body: "Time-Slot is a web application I developed for a local salon to help manage appointments efficiently. As a full-stack developer, I built the entire solution — from a Supabase backend through to a React frontend.",
      },
      {
        type: "image",
        src: "/assets/timeslot/calendar-{theme}.png",
        alt: "Time-Slot custom calendar component",
      },
      {
        type: "text",
        body: [
          "A key feature of Time-Slot is the custom-built, responsive, dynamic calendar. It lets both customers and salon owners view, add, and modify appointments easily — keeping scheduling smooth and avoiding conflicts.",
          "The backend uses Supabase for a scalable, efficient database. It handles authentication and appointment storage seamlessly, speeding up development without compromising performance or security.",
        ],
      },
      {
        type: "gallery",
        images: [
          { src: "/assets/timeslot/services-{theme}.png", alt: "Time-Slot services view" },
          { src: "/assets/timeslot/example-{theme}.png", alt: "Time-Slot booking example" },
        ],
      },
      {
        type: "text",
        body: [
          "The frontend was built with responsiveness in mind, so salon owners and clients can access Time-Slot from any device with a sleek, easy-to-navigate experience.",
          "I also implemented a dynamic calendar that adapts to appointment load, offering visual cues for peak times — crucial for optimising staff schedules and keeping customers happy.",
        ],
      },
    ]}
  />
);

export default Timeslot;
