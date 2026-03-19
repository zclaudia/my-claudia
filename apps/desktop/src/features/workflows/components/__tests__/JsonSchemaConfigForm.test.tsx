import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { JsonSchemaConfigForm } from '../JsonSchemaConfigForm';

describe('JsonSchemaConfigForm', () => {
  it('renders string input for string property', () => {
    const schema = {
      properties: {
        name: { type: 'string', title: 'Name' },
      },
    };
    const onChange = vi.fn();
    const { container } = render(
      <JsonSchemaConfigForm schema={schema} config={{ name: 'hello' }} onChange={onChange} />,
    );
    expect(container.textContent).toContain('Name');
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('hello');
  });

  it('calls onChange when string input changes', () => {
    const schema = {
      properties: {
        name: { type: 'string', title: 'Name' },
      },
    };
    const onChange = vi.fn();
    const { container } = render(
      <JsonSchemaConfigForm schema={schema} config={{ name: '' }} onChange={onChange} />,
    );
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'world' } });
    expect(onChange).toHaveBeenCalledWith({ name: 'world' });
  });

  it('renders number input for number property', () => {
    const schema = {
      properties: {
        count: { type: 'number', title: 'Count', minimum: 0, maximum: 100 },
      },
    };
    const onChange = vi.fn();
    const { container } = render(
      <JsonSchemaConfigForm schema={schema} config={{ count: 42 }} onChange={onChange} />,
    );
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('42');
  });

  it('renders checkbox for boolean property', () => {
    const schema = {
      properties: {
        enabled: { type: 'boolean', title: 'Enabled' },
      },
    };
    const onChange = vi.fn();
    const { container } = render(
      <JsonSchemaConfigForm schema={schema} config={{ enabled: true }} onChange={onChange} />,
    );
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(true);
  });

  it('calls onChange when checkbox toggled', () => {
    const schema = {
      properties: {
        enabled: { type: 'boolean', title: 'Enabled' },
      },
    };
    const onChange = vi.fn();
    const { container } = render(
      <JsonSchemaConfigForm schema={schema} config={{ enabled: true }} onChange={onChange} />,
    );
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith({ enabled: false });
  });

  it('renders select for enum property', () => {
    const schema = {
      properties: {
        color: { title: 'Color', enum: ['red', 'green', 'blue'] },
      },
    };
    const onChange = vi.fn();
    const { container } = render(
      <JsonSchemaConfigForm schema={schema} config={{ color: 'green' }} onChange={onChange} />,
    );
    const select = container.querySelector('select') as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe('green');
    // Check option count: 3 enum values + 1 placeholder
    expect(select.querySelectorAll('option').length).toBe(4);
  });

  it('renders textarea for textarea format', () => {
    const schema = {
      properties: {
        body: { type: 'string', title: 'Body', format: 'textarea' },
      },
    };
    const onChange = vi.fn();
    const { container } = render(
      <JsonSchemaConfigForm schema={schema} config={{ body: 'text here' }} onChange={onChange} />,
    );
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();
    expect(textarea.value).toBe('text here');
  });

  it('renders password input for password format', () => {
    const schema = {
      properties: {
        secret: { type: 'string', title: 'Secret', format: 'password' },
      },
    };
    const onChange = vi.fn();
    const { container } = render(
      <JsonSchemaConfigForm schema={schema} config={{ secret: 'abc' }} onChange={onChange} />,
    );
    const input = container.querySelector('input[type="password"]') as HTMLInputElement;
    expect(input).toBeTruthy();
  });

  it('shows required asterisk for required fields', () => {
    const schema = {
      properties: {
        name: { type: 'string', title: 'Name' },
      },
      required: ['name'],
    };
    const onChange = vi.fn();
    const { container } = render(
      <JsonSchemaConfigForm schema={schema} config={{}} onChange={onChange} />,
    );
    expect(container.textContent).toContain('Name *');
  });

  it('shows description text', () => {
    const schema = {
      properties: {
        name: { type: 'string', title: 'Name', description: 'Enter your name' },
      },
    };
    const onChange = vi.fn();
    const { container } = render(
      <JsonSchemaConfigForm schema={schema} config={{}} onChange={onChange} />,
    );
    expect(container.textContent).toContain('Enter your name');
  });

  it('renders step output reference hint when properties exist', () => {
    const schema = {
      properties: {
        name: { type: 'string' },
      },
    };
    const onChange = vi.fn();
    const { container } = render(
      <JsonSchemaConfigForm schema={schema} config={{}} onChange={onChange} />,
    );
    expect(container.textContent).toContain('${stepId.output.field}');
  });

  it('renders nothing when no properties', () => {
    const schema = { properties: {} };
    const onChange = vi.fn();
    const { container } = render(
      <JsonSchemaConfigForm schema={schema} config={{}} onChange={onChange} />,
    );
    // Should not show the hint text either
    expect(container.textContent).not.toContain('${stepId.output.field}');
  });
});
