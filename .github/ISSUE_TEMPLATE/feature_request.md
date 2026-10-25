---
name: Feature request
about: Suggest an improvement
title: ""
labels: enhancement
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem are you trying to solve?
      description: Describe the workflow, not the implementation you have in mind.
    validations:
      required: true

  - type: textarea
    id: proposal
    attributes:
      label: Proposed change
      description: What should the tool do differently?
    validations:
      required: true

  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives you considered
