import React, { useState } from "react";
import Card from "../../Components/Card/Card";
import Button from "../../DevComponents/Button/Button";
import Dropdown from "../../DevComponents/Dropdown/Dropdown";
import Input from "../../DevComponents/Input/Input";
import ThemeSwitch from "../../DevComponents/ThemeSwitch/ThemeSwitch";
import TimePicker from "../../DevComponents/TimePicker/TimePicker";
import RadioGroup from "../../DevComponents/RadioGroup/RadioGroup";
import { useAlert } from "../../DevComponents/Providers/Alert";
import "./Showcase.css";

const ComponentShowcase = () => {
  const [orientation, setOrientation] = useState("horizontal");
  const alert = useAlert();

  const buttonString = `<Button 
  onClick={() => alert.showAlert("success", "Button Clicked!")}
  color="success"
>
  Success
</Button>`;

  const dropdownString = `<Dropdown
  options={['Option 1', 'Option 2', 'Option 3']}
  onClick={s => console.log('Selected:', s)}
>
  Dropdown Button
</Dropdown>`;

  const inputString = `<Input label="Standard" />
<Input label="Textarea" type="textarea" />
<Input
  type="select"
  options={[
    { value: "option 1", label: "Option 1" },
    { value: "option 2", label: "Option 2" },
    { value: "option 3", label: "Option 3" },
  ]}
/>`;

  const radioGroupString = `<RadioGroup
  options={[
    { value: "option 1", label: "Option 1" },
    { value: "option 2", label: "Option 2" },
    { value: "option 3", label: "Option 3" },
  ]}
/>`;

  return (
    <div className="showcase-container">
      <h1>Reusable React Components Showcase</h1>
      <RadioGroup
        options={[
          { value: "horizontal", label: "Horizontal" },
          { value: "vertical", label: "Vertical" },
        ]}
        onChange={(value) => setOrientation(value)}
      />
      <div
        className={`showcase-grid ${orientation}`}
        style={{
          display: "grid",
          gridTemplateColumns: orientation === "horizontal" ? "1fr 1fr" : "1fr",
          gap: "1rem",
        }}
      >
        <Card title="Button" codeSnippet={buttonString} className="row">
          <Button
            onClick={() => alert.showAlert("success", "Button Clicked!")}
            color="success"
          >
            Success
          </Button>
          <Button
            onClick={() => alert.showAlert("warning", "Button Clicked!")}
            color="warning"
          >
            Warning
          </Button>
          <Button
            onClick={() => alert.showAlert("info", "Button Clicked!")}
            color="info"
          >
            Info
          </Button>
          <Button
            onClick={() => alert.showAlert("error", "Button Clicked!")}
            color="danger"
          >
            Error
          </Button>
        </Card>

        <Card title="Input" codeSnippet={inputString}>
          <Input label="Standard" />
          <Input label="Textarea" type="textarea" />
          <Input
            type="select"
            options={[
              { value: "option 1", label: "Option 1" },
              { value: "option 2", label: "Option 2" },
              { value: "option 3", label: "Option 3" },
            ]}
          />
        </Card>

        <Card title="Dropdown" codeSnippet={dropdownString}>
          <Dropdown
            options={["Option 1", "Option 2", "Option 3"]}
            onClick={(s) => console.log("Selected:", s)}
            listType="checkbox"
          >
            Dropdown Button
          </Dropdown>
        </Card>

        <Card title="Theme Switch" codeSnippet={`<ThemeSwitch />`}>
          <ThemeSwitch />
        </Card>

        <Card
          title="TimePicker"
          codeSnippet={`<TimePicker label="Time Picker" />`}
        >
          <TimePicker label="Time Picker" />
        </Card>

        <Card title="Radio Group" codeSnippet={radioGroupString}>
          <RadioGroup
            options={[
              { value: "option 1", label: "Option 1" },
              { value: "option 2", label: "Option 2" },
              { value: "option 3", label: "Option 3" },
            ]}
          />
        </Card>
      </div>
    </div>
  );
};

export default ComponentShowcase;
